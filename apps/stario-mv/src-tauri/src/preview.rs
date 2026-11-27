//! プレビューの糸（MV-0007 決定2〜4）＝窓・GPU・描画の核・開いている動画を持ち、画面からの命令で描く。
//!
//! ⚠️ 描くのは書き出しと同じ描画の核（`Renderer::render_texture`）。窓へは写すだけ（`mv_render::present`）。

use crate::audio::AudioOut;
use crate::clock;
use mv_core::model::Project;
use mv_render::present::{pick_surface_format, Presenter, Rect};
use mv_render::text::Fonts;
use mv_render::{Gpu, Renderer};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tauri::{Emitter, WebviewWindow};

/// 帯と欄の外の色（画面の暗い地と同じ・sRGB の値）。
pub const CLEAR: [f32; 4] = [0.078, 0.082, 0.094, 1.0];
/// 外の変更（project.json）を見る間隔。
pub const WATCH_INTERVAL: Duration = Duration::from_millis(500);
/// 音の時計がこれだけ進まなければ、機器が止まったとみなす。
pub const AUDIO_STALL: Duration = Duration::from_millis(500);

/// 画面からの命令。
pub enum Cmd {
    Open {
        dir: PathBuf,
        project: Box<Project>,
    },
    Rect(Rect),
    Play,
    Pause,
    Seek(i64),
    Step(i64),
    Composition(String),
    /// 音を消す（true）／鳴らす（false）。
    Mute(bool),
    /// 掴んで動かしている途中の編集（MV-0008 決定1）＝写しに当てて描くだけ・保存しない。`None`＝試しをやめる。
    Trial(Option<Vec<serde_json::Value>>),
    /// 画面の取引を保存した＝すぐ読み直す（外の変更を見る間隔を待たない）。試しもやめる。
    Reload,
    /// 今のコマの、見えているレイヤーの枠（MV-0008 決定6）。答えは窓の画素で返す。
    Bounds(std::sync::mpsc::Sender<Result<serde_json::Value, String>>),
}

/// 画面へ知らせる今の状態。
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub composition_id: String,
    pub frame: i64,
    pub playing: bool,
    /// 再生中に実際に描けたコマの速さ（1秒ごと）。
    pub fps: f64,
    /// 再生を始めてから間に合わずに飛ばしたコマの数。
    pub dropped: u64,
    /// 音を鳴らして、その時計で進めているか（音の無い動画・消したとき・機器が無いときは false）。
    pub audio: bool,
}

struct Open {
    dir: PathBuf,
    project: Project,
    comp_id: String,
    modified: Option<SystemTime>,
    /// 試しの編集と、それを写しに当てた動画（描くのはこちら＝[`Open::shown`]）。
    trial_ops: Option<Vec<serde_json::Value>>,
    trial: Option<Project>,
}

impl Open {
    /// 描く動画（試しがあれば試しを当てた写し）。
    fn shown(&self) -> &Project {
        self.trial.as_ref().unwrap_or(&self.project)
    }

    /// 試しを今の中身に当て直す（外の変更で中身が変わったときも、掴んでいる途中の見え方を保つ）。
    fn retrial(&mut self) {
        self.trial = self
            .trial_ops
            .as_deref()
            .and_then(|ops| crate::edit::trial_project(&self.project, ops));
    }
}

/// 糸を起こす（窓に描く準備に失敗したら、理由を画面へ知らせて終わる）。
pub fn spawn(
    window: WebviewWindow,
    fonts: Vec<PathBuf>,
    ffmpeg: Option<PathBuf>,
    rx: Receiver<Cmd>,
) {
    std::thread::spawn(move || {
        if let Err(e) = run(&window, &fonts, ffmpeg, rx) {
            let _ = window.emit("preview-error", Some(e));
        }
    });
}

fn modified(dir: &Path) -> Option<SystemTime> {
    std::fs::metadata(dir.join(mv_core::io::PROJECT_FILE))
        .and_then(|m| m.modified())
        .ok()
}

fn run(
    window: &WebviewWindow,
    fonts: &[PathBuf],
    ffmpeg: Option<PathBuf>,
    rx: Receiver<Cmd>,
) -> Result<(), String> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let surface = instance
        .create_surface(window.clone())
        .map_err(|e| format!("プレビューの窓を用意できませんでした（{e}）。"))?;
    let (gpu, adapter) = Gpu::for_surface(&instance, &surface).map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let mut config = surface
        .get_default_config(&adapter, size.width.max(1), size.height.max(1))
        .ok_or("この GPU ではプレビューの窓に描けません。")?;
    let caps = surface.get_capabilities(&adapter);
    // sRGB の印が付かない形で受ける（描画の核の値をそのまま写す）。無ければ同じ形の印なしの見え方で描く
    let view_format = match pick_surface_format(&caps.formats) {
        Some(f) => {
            config.format = f;
            f
        }
        None => {
            let f = config.format.remove_srgb_suffix();
            config.view_formats = vec![f];
            f
        }
    };
    config.present_mode = wgpu::PresentMode::AutoVsync;
    surface.configure(&gpu.device, &config);
    let refs: Vec<&Path> = fonts.iter().map(PathBuf::as_path).collect();
    let fonts = Fonts::load(&refs).map_err(|e| e.to_string())?;
    let presenter = Presenter::new(&gpu.device, view_format);
    let mut renderer = Renderer::new(gpu, fonts);
    if let Some(f) = &ffmpeg {
        renderer.set_ffmpeg(f.clone());
    }

    let mut open: Option<Open> = None;
    let mut rect = Rect {
        x: 0.0,
        y: 0.0,
        w: 0.0,
        h: 0.0,
    };
    let mut frame: i64 = 0;
    let mut playing = false;
    let (mut play_start, mut play_from) = (Instant::now(), 0i64);
    let mut dropped: u64 = 0;
    let (mut fps_window, mut fps_count, mut fps) = (Instant::now(), 0u32, 0.0f64);
    let mut last_watch = Instant::now();
    let mut dirty = true;
    // 音（MV-0007 決定6）：出口・混ぜた音（動画の版ごと）・音の時計の始まり
    let mut audio_out: Option<AudioOut> = None;
    let mut version: u64 = 0;
    let mut mix: Option<(u64, Option<Arc<Vec<f32>>>)> = None;
    let mut audio_clock: Option<u64> = None;
    let mut muted = false;
    // 音の時計の見張り（最後に進んだ位置と時刻）
    let mut audio_seen: (u64, Instant) = (0, Instant::now());

    loop {
        let comp_info = open.as_ref().and_then(|o| {
            o.project
                .compositions
                .iter()
                .find(|c| c.id == o.comp_id)
                .map(|c| {
                    (
                        f64::from(c.fps.num) / f64::from(c.fps.den),
                        i64::from(c.duration_frames),
                    )
                })
        });
        let timeout = match (playing, comp_info) {
            (true, Some((cfps, _))) => Duration::from_secs_f64(
                clock::wait_sec(
                    play_from,
                    cfps,
                    elapsed(audio_clock, audio_out.as_ref(), play_start),
                    frame,
                )
                .clamp(0.001, 0.25),
            ),
            _ => Duration::from_millis(250),
        };
        let first = match rx.recv_timeout(timeout) {
            Ok(c) => Some(c),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        };
        let mut want_play = false;
        let mut force_reload = false;
        for cmd in first.into_iter().chain(rx.try_iter()) {
            let duration = comp_info.map(|c| c.1).unwrap_or(1);
            match cmd {
                Cmd::Open { dir, project } => {
                    let comp_id = project.main_composition_id.clone();
                    open = Some(Open {
                        modified: modified(&dir),
                        dir,
                        project: *project,
                        comp_id,
                        trial_ops: None,
                        trial: None,
                    });
                    frame = 0;
                    playing = false;
                    version += 1;
                }
                Cmd::Rect(r) => rect = r,
                Cmd::Play => {
                    if comp_info.is_some() {
                        if frame >= duration - 1 {
                            frame = 0; // 最後で押したら最初から
                        }
                        want_play = true;
                    }
                }
                Cmd::Mute(m) => {
                    muted = m;
                    // 再生中なら、今のコマから時計を選び直す
                    want_play = playing;
                }
                Cmd::Pause => playing = false,
                Cmd::Seek(f) => {
                    playing = false;
                    frame = f.clamp(0, duration - 1);
                }
                Cmd::Step(d) => {
                    playing = false;
                    frame = (frame + d).clamp(0, duration - 1);
                }
                Cmd::Trial(ops) => {
                    if let Some(o) = open.as_mut() {
                        o.trial_ops = ops;
                        o.retrial();
                    }
                }
                Cmd::Reload => {
                    if let Some(o) = open.as_mut() {
                        o.trial_ops = None;
                        o.trial = None;
                    }
                    force_reload = true;
                }
                Cmd::Bounds(reply) => {
                    let r = match &open {
                        Some(o) => bounds(&mut renderer, o, frame, rect),
                        None => Err("動画を開いていません。".into()),
                    };
                    let _ = reply.send(r);
                    continue;
                }
                Cmd::Composition(id) => {
                    if let Some(o) = open.as_mut() {
                        if o.project.compositions.iter().any(|c| c.id == id) {
                            o.comp_id = id;
                            frame = 0;
                            playing = false;
                            version += 1;
                        }
                    }
                }
            }
            dirty = true;
        }
        if want_play {
            playing = true;
            play_from = frame;
            dropped = 0;
            fps_window = Instant::now();
            fps_count = 0;
            audio_clock = None;
            if let (false, Some(o), Some((cfps, _)), Some(ff)) = (muted, &open, comp_info, &ffmpeg)
            {
                if audio_out.is_none() {
                    match AudioOut::open() {
                        Ok(a) => audio_out = Some(a),
                        Err(e) => {
                            let _ = window.emit("preview-notice", Some(e));
                        }
                    }
                }
                if let Some(a) = &audio_out {
                    if mix.as_ref().map(|m| m.0) != Some(version) {
                        let _ = window.emit("preview-notice", Some("音を準備しています…"));
                        let r = mv_export::mix_pcm(&o.project, &o.comp_id, &o.dir, ff, a.rate);
                        let pcm = match r {
                            Ok(p) => {
                                let _ = window.emit("preview-notice", None::<String>);
                                p.map(Arc::new)
                            }
                            Err(e) => {
                                let _ = window.emit(
                                    "preview-notice",
                                    Some(format!(
                                        "音を混ぜられませんでした（絵だけ再生します）：{e}"
                                    )),
                                );
                                None
                            }
                        };
                        mix = Some((version, pcm));
                    }
                    if let Some((_, Some(pcm))) = &mix {
                        if let Ok(mut g) = a.shared.pcm.lock() {
                            *g = Some(pcm.clone());
                        }
                        let start = (play_from as f64 / cfps * f64::from(a.rate)).round() as u64;
                        a.shared.pos.store(start, Ordering::Release);
                        a.shared.playing.store(true, Ordering::Release);
                        audio_clock = Some(start);
                        audio_seen = (start, Instant::now());
                    }
                }
            }
            // 混ぜている間に過ぎた時間を数えない
            play_start = Instant::now();
        }

        // 外の変更を映す（C-3 の読む側）
        if force_reload || last_watch.elapsed() >= WATCH_INTERVAL {
            last_watch = Instant::now();
            if let Some(o) = open.as_mut() {
                let m = modified(&o.dir);
                // ⚠️ 画面の保存は同じ秒の中で続くことがある＝更新時刻だけで見ると読み直しを取りこぼす
                if force_reload || m != o.modified {
                    o.modified = m;
                    match mv_core::io::load_project(&o.dir) {
                        Ok(l) => {
                            if !l.project.compositions.iter().any(|c| c.id == o.comp_id) {
                                o.comp_id = l.project.main_composition_id.clone();
                                frame = 0;
                            }
                            let _ = window.emit("project-changed", crate::summary(&o.dir, &l));
                            o.project = l.project;
                            o.retrial();
                            version += 1;
                            dirty = true;
                        }
                        Err(e) => {
                            // 壊れたものは描かない＝前に描けていた状態のまま理由を出す
                            let _ = window.emit(
                                "preview-error",
                                Some(format!("動画が読み直せない形になりました（前の状態を表示しています）：{e}")),
                            );
                        }
                    }
                }
            }
        }

        // 窓の大きさ
        if let Ok(s) = window.inner_size() {
            if (s.width.max(1), s.height.max(1)) != (config.width, config.height) {
                config.width = s.width.max(1);
                config.height = s.height.max(1);
                surface.configure(&renderer.gpu().device, &config);
                dirty = true;
            }
        }

        // 音の機器が止まったら（リモートが切れた など）、黙って固まらずに知らせて時計へ切り替える
        if let (true, Some(start), Some(a)) = (playing, audio_clock, audio_out.as_ref()) {
            let pos = a.shared.pos.load(Ordering::Acquire);
            if pos != audio_seen.0 {
                audio_seen = (pos, Instant::now());
            } else if audio_seen.1.elapsed() >= AUDIO_STALL {
                let done = pos.saturating_sub(start) as f64 / f64::from(a.rate);
                play_start = Instant::now() - Duration::from_secs_f64(done);
                audio_clock = None;
                a.shared.playing.store(false, Ordering::Release);
                let _ = window.emit(
                    "preview-notice",
                    Some("音の機器が止まりました（絵だけ再生しています）。"),
                );
            }
        }

        // 再生を進める
        if playing {
            if let Some((cfps, dur)) = comp_info {
                if let Some(step) = clock::next(
                    play_from,
                    cfps,
                    elapsed(audio_clock, audio_out.as_ref(), play_start),
                    frame,
                    dur,
                ) {
                    frame = step.frame;
                    dropped += step.dropped;
                    playing = !step.finished;
                    dirty = true;
                }
            }
        }

        stop_audio_unless_playing(playing, audio_out.as_ref());
        if !dirty {
            continue;
        }
        dirty = false;
        let image = match &open {
            Some(o) => match renderer.render_texture(o.shown(), &o.comp_id, frame, &o.dir) {
                Ok(t) => {
                    let _ = window.emit("preview-error", None::<String>);
                    Some(t)
                }
                Err(e) => {
                    // 描けないコマは止めて理由を出す（黙って飛ばさない）
                    playing = false;
                    let _ = window.emit(
                        "preview-error",
                        Some(format!("コマ {frame} を描けませんでした：{e}")),
                    );
                    None
                }
            },
            None => None,
        };
        stop_audio_unless_playing(playing, audio_out.as_ref());
        let out = match surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f)
            | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            _ => {
                surface.configure(&renderer.gpu().device, &config);
                dirty = true;
                continue;
            }
        };
        let view = out.texture.create_view(&wgpu::TextureViewDescriptor {
            format: Some(view_format),
            ..Default::default()
        });
        let g = renderer.gpu();
        presenter.draw(&g.device, &g.queue, &view, rect, image.as_ref(), CLEAR);
        g.queue.present(out);

        if playing {
            fps_count += 1;
            let secs = fps_window.elapsed().as_secs_f64();
            if secs >= 1.0 {
                fps = f64::from(fps_count) / secs;
                fps_count = 0;
                fps_window = Instant::now();
            }
        }
        if let Some(o) = &open {
            let _ = window.emit(
                "preview-status",
                Status {
                    composition_id: o.comp_id.clone(),
                    frame,
                    playing,
                    fps,
                    dropped,
                    audio: playing && audio_clock.is_some(),
                },
            );
        }
    }
}

/// 今のコマの、見えているレイヤーの枠を窓の画素で（描画の核の枠を、絵を写した欄の位置と倍率で写す）。
/// ⚠️ 写し方は窓へ写すときと同じ `present::fit`＝画面で倍率を書き写さない。
fn bounds(
    renderer: &mut Renderer,
    o: &Open,
    frame: i64,
    rect: Rect,
) -> Result<serde_json::Value, String> {
    let p = o.shown();
    let comp = p
        .compositions
        .iter()
        .find(|c| c.id == o.comp_id)
        .ok_or("コンポジションが見つかりません。")?;
    let quads = renderer
        .layer_quads(p, &o.comp_id, frame, &o.dir)
        .map_err(|e| e.to_string())?;
    let img = mv_render::present::fit(rect, comp.width, comp.height);
    let scale = f64::from(img.w) / f64::from(comp.width.max(1));
    Ok(bounds_json(
        &quads,
        scale,
        [f64::from(img.x), f64::from(img.y)],
        frame,
    ))
}

/// 枠（コンポジションの画素）を窓の画素へ写した答え。`scale`＝コンポジションの 1 画素が窓の何画素か。
pub fn bounds_json(
    quads: &[mv_render::LayerQuad],
    scale: f64,
    origin: [f64; 2],
    frame: i64,
) -> serde_json::Value {
    serde_json::json!({
        "frame": frame,
        "scale": scale,
        "layers": quads.iter().map(|q| serde_json::json!({
            "layerId": q.layer_id,
            "corners": q.corners.map(|[x, y]| [origin[0] + x * scale, origin[1] + y * scale]),
        })).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 枠は欄の位置と倍率で窓の画素へ写す() {
        let q = [mv_render::LayerQuad {
            layer_id: "lyr_A".into(),
            corners: [[0.0, 0.0], [10.0, 0.0], [10.0, 5.0], [0.0, 5.0]],
        }];
        let v = bounds_json(&q, 2.0, [100.0, 50.0], 7);
        assert_eq!(v["frame"], 7);
        assert_eq!(v["scale"], 2.0);
        assert_eq!(v["layers"][0]["layerId"], "lyr_A");
        assert_eq!(
            v["layers"][0]["corners"],
            serde_json::json!([[100.0, 50.0], [120.0, 50.0], [120.0, 60.0], [100.0, 60.0]])
        );
    }
}

/// 再生の経過（秒）。音を鳴らしていれば鳴らした量で、無ければ時計で数える（MV-0007 決定6）。
fn elapsed(audio_clock: Option<u64>, out: Option<&AudioOut>, play_start: Instant) -> f64 {
    match (audio_clock, out) {
        (Some(start), Some(a)) => {
            a.shared.pos.load(Ordering::Acquire).saturating_sub(start) as f64 / f64::from(a.rate)
        }
        _ => play_start.elapsed().as_secs_f64(),
    }
}

/// 止まったら音も止める。
fn stop_audio_unless_playing(playing: bool, out: Option<&AudioOut>) {
    if let (false, Some(a)) = (playing, out) {
        a.shared.playing.store(false, Ordering::Release);
    }
}
