//! プレビューの糸（MV-0007 決定2〜4）＝窓・GPU・描画の核・開いている動画を持ち、画面からの命令で描く。
//!
//! ⚠️ 描くのは書き出しと同じ描画の核（`Renderer::render_texture`）。窓へは写すだけ（`mv_render::present`）。

use crate::clock;
use mv_core::model::Project;
use mv_render::present::{pick_surface_format, Presenter, Rect};
use mv_render::text::Fonts;
use mv_render::{Gpu, Renderer};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant, SystemTime};
use tauri::{Emitter, WebviewWindow};

/// 帯と欄の外の色（画面の暗い地と同じ・sRGB の値）。
pub const CLEAR: [f32; 4] = [0.078, 0.082, 0.094, 1.0];
/// 外の変更（project.json）を見る間隔。
pub const WATCH_INTERVAL: Duration = Duration::from_millis(500);

/// 画面からの命令。
pub enum Cmd {
    Open { dir: PathBuf, project: Box<Project> },
    Rect(Rect),
    Play,
    Pause,
    Seek(i64),
    Step(i64),
    Composition(String),
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
}

struct Open {
    dir: PathBuf,
    project: Project,
    comp_id: String,
    modified: Option<SystemTime>,
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
    if let Some(f) = ffmpeg {
        renderer.set_ffmpeg(f);
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
                clock::wait_sec(play_from, cfps, play_start.elapsed().as_secs_f64(), frame)
                    .clamp(0.001, 0.25),
            ),
            _ => Duration::from_millis(250),
        };
        let first = match rx.recv_timeout(timeout) {
            Ok(c) => Some(c),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        };
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
                    });
                    frame = 0;
                    playing = false;
                }
                Cmd::Rect(r) => rect = r,
                Cmd::Play => {
                    if comp_info.is_some() {
                        if frame >= duration - 1 {
                            frame = 0; // 最後で押したら最初から
                        }
                        playing = true;
                        play_start = Instant::now();
                        play_from = frame;
                        dropped = 0;
                        fps_window = Instant::now();
                        fps_count = 0;
                    }
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
                Cmd::Composition(id) => {
                    if let Some(o) = open.as_mut() {
                        if o.project.compositions.iter().any(|c| c.id == id) {
                            o.comp_id = id;
                            frame = 0;
                            playing = false;
                        }
                    }
                }
            }
            dirty = true;
        }

        // 外の変更を映す（C-3 の読む側）
        if last_watch.elapsed() >= WATCH_INTERVAL {
            last_watch = Instant::now();
            if let Some(o) = open.as_mut() {
                let m = modified(&o.dir);
                if m != o.modified {
                    o.modified = m;
                    match mv_core::io::load_project(&o.dir) {
                        Ok(l) => {
                            if !l.project.compositions.iter().any(|c| c.id == o.comp_id) {
                                o.comp_id = l.project.main_composition_id.clone();
                                frame = 0;
                            }
                            let _ = window.emit("project-changed", crate::summary(&o.dir, &l));
                            o.project = l.project;
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

        // 再生を進める
        if playing {
            if let Some((cfps, dur)) = comp_info {
                if let Some(step) = clock::next(
                    play_from,
                    cfps,
                    play_start.elapsed().as_secs_f64(),
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

        if !dirty {
            continue;
        }
        dirty = false;
        let image = match &open {
            Some(o) => match renderer.render_texture(&o.project, &o.comp_id, frame, &o.dir) {
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
                },
            );
        }
    }
}
