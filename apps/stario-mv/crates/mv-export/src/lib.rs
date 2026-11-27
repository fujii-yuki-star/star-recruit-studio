//! すたりおMV の画面なしの書き出し（γ0.1 の段階④）。
//!
//! 描画の核（`mv-render`）で1コマずつ描き、生の RGBA を FFmpeg の標準入力へ流して MP4（H.264）にする。
//! ⚠️ プレビューと同じ描画を通す（MV-0002）。⚠️ 中身の検査（2段目）に問題がある動画は書き出さない（黙って別の結果にしない）。
//! ⚠️ 書きかけで止まっても、前からあるファイルを壊さない＝一時ファイルに書いてから置き換える。

pub mod args;

use args::{encode_args, mix_args, probe_encoder_args, AudioInput, EncodeSpec, H264_ENCODERS};
use mv_core::eval::is_visible_at;
use mv_core::model::{AssetKind, AssetSource, LayerType, Project};
use mv_core::validate::{validate, Issue};
use mv_render::{RenderError, Renderer};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

/// 書き出せなかった理由。
#[derive(Debug)]
pub enum ExportError {
    /// 中身の検査に問題がある（直してから書き出す）。
    Invalid(Vec<Issue>),
    FfmpegNotFound(String),
    NoEncoder(String),
    Render(RenderError),
    Ffmpeg(String),
    Io(std::io::Error),
    Cancelled,
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExportError::Invalid(v) => {
                write!(f, "動画に直すところがあるので書き出しませんでした（{} 件）。", v.len())?;
                for i in v.iter().take(5) {
                    write!(f, "\n  {}: {}", i.path, i.message)?;
                }
                Ok(())
            }
            ExportError::FfmpegNotFound(e) => write!(f, "FFmpeg が見つかりません（{e}）。--ffmpeg で場所を指定するか、環境変数 FFMPEG_PATH を設定してください。"),
            ExportError::NoEncoder(e) => write!(f, "このパソコンで使える H.264 の書き出しの道具が見つかりません（{e}）。"),
            ExportError::Render(e) => write!(f, "{e}"),
            ExportError::Ffmpeg(e) => write!(f, "FFmpeg が止まりました：{e}"),
            ExportError::Io(e) => write!(f, "ファイルを書けませんでした（{e}）。保存先と空き容量を確かめてください。"),
            ExportError::Cancelled => write!(f, "書き出しを止めました。"),
        }
    }
}

impl std::error::Error for ExportError {}

/// FFmpeg を探す：渡された場所 → 環境変数 FFMPEG_PATH → 候補（アプリの同梱など）→ PATH の `ffmpeg`。
pub fn locate_ffmpeg(
    explicit: Option<&Path>,
    candidates: &[PathBuf],
) -> Result<PathBuf, ExportError> {
    let mut tried = Vec::new();
    let env = std::env::var_os("FFMPEG_PATH").map(PathBuf::from);
    for p in explicit
        .map(Path::to_path_buf)
        .into_iter()
        .chain(env)
        .chain(candidates.iter().cloned())
    {
        if p.is_file() {
            return Ok(p);
        }
        tried.push(p.display().to_string());
    }
    if Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
    {
        return Ok(PathBuf::from("ffmpeg"));
    }
    tried.push("PATH の ffmpeg".into());
    Err(ExportError::FfmpegNotFound(format!(
        "探した場所：{}",
        tried.join("・")
    )))
}

/// 使える H.264 の道具を上から順に試して選ぶ（一覧に載っていても GPU が無いと動かない道具がある）。
/// ⚠️ **書き出す大きさで**試す＝GPU の道具には小さすぎる画面を断るものがある（Intel の道具は 64×36 で開けない）。
pub fn pick_encoder(ffmpeg: &Path, width: u32, height: u32) -> Result<String, ExportError> {
    let mut failures = Vec::new();
    for enc in H264_ENCODERS {
        let out = Command::new(ffmpeg)
            .args(probe_encoder_args(enc, width, height))
            .stdin(Stdio::null())
            .output()
            .map_err(|e| ExportError::FfmpegNotFound(e.to_string()))?;
        if out.status.success() {
            return Ok((*enc).into());
        }
        failures.push((*enc).to_string());
    }
    Err(ExportError::NoEncoder(format!(
        "試した道具：{}",
        failures.join("・")
    )))
}

/// 書き出しの指定。
pub struct ExportOptions {
    pub ffmpeg: PathBuf,
    pub out: PathBuf,
    /// 無ければ書き出しの既定のコンポジション。
    pub composition_id: Option<String>,
    /// 無ければ自動で選ぶ。
    pub encoder: Option<String>,
}

/// 書き出しの結果。
#[derive(Debug, Clone, PartialEq)]
pub struct ExportReport {
    pub out: PathBuf,
    pub frames: u32,
    pub encoder: String,
    pub audio_layers: usize,
}

/// 書き出す。`progress(済んだコマ, 全部のコマ)`。`cancel` が立ったら止めて、書きかけを消す。
pub fn export(
    renderer: &mut Renderer,
    project: &Project,
    project_dir: &Path,
    opts: &ExportOptions,
    mut progress: impl FnMut(u32, u32),
    cancel: &AtomicBool,
) -> Result<ExportReport, ExportError> {
    let issues = validate(project);
    if !issues.is_empty() {
        return Err(ExportError::Invalid(issues));
    }
    let comp_id = opts
        .composition_id
        .clone()
        .unwrap_or_else(|| project.main_composition_id.clone());
    let comp = project
        .compositions
        .iter()
        .find(|c| c.id == comp_id)
        .ok_or_else(|| ExportError::Render(RenderError::CompositionNotFound(comp_id.clone())))?;
    let encoder = match &opts.encoder {
        Some(e) => e.clone(),
        None => pick_encoder(&opts.ffmpeg, comp.width, comp.height)?,
    };
    // 映像のレイヤーも描画の核が FFmpeg で読む（MV-0006 決定4）
    renderer.set_ffmpeg(opts.ffmpeg.clone());
    let fps = comp.fps.num as f64 / comp.fps.den as f64;
    let audio = audio_inputs(project, comp, project_dir, fps, &opts.ffmpeg)?;
    let total = comp.duration_frames;
    let tmp = writing_path(&opts.out);
    let spec = EncodeSpec {
        width: comp.width,
        height: comp.height,
        fps: comp.fps,
        encoder: encoder.clone(),
        audio: audio.clone(),
        duration_sec: total as f64 / fps,
        out: tmp.display().to_string(),
    };

    let mut child = Command::new(&opts.ffmpeg)
        .args(encode_args(&spec))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ExportError::FfmpegNotFound(e.to_string()))?;
    // ⚠️ 標準エラーを別に読み続ける（溜まると FFmpeg が止まり、こちらの書き込みも止まる）
    let mut stderr = child.stderr.take().expect("stderr");
    let err_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let mut stdin = child.stdin.take().expect("stdin");
    let result: Result<(), ExportError> = (|| {
        for f in 0..total as i64 {
            if cancel.load(Ordering::SeqCst) {
                return Err(ExportError::Cancelled);
            }
            let frame = renderer
                .render(project, &comp_id, f, project_dir)
                .map_err(ExportError::Render)?;
            stdin
                .write_all(&frame.data)
                .map_err(|e| ExportError::Ffmpeg(format!("コマを渡せませんでした（{e}）")))?;
            progress(f as u32 + 1, total);
        }
        Ok(())
    })();
    drop(stdin);
    if result.is_err() {
        let _ = child.kill();
    }
    let status = child.wait().map_err(ExportError::Io);
    let err_text = err_reader.join().unwrap_or_default();
    // ⚠️ 失敗の後片づけは**1か所**（どの失敗でも書きかけを消す＝検査が1つの道を通る）
    let outcome: Result<(), ExportError> = match (result, status) {
        // FFmpeg が先に止まったなら、その理由のほうが役に立つ
        (Err(e), _) if !err_text.trim().is_empty() && !matches!(e, ExportError::Cancelled) => {
            Err(ExportError::Ffmpeg(last_lines(&err_text)))
        }
        (Err(e), _) => Err(e),
        (Ok(()), Err(e)) => Err(e),
        (Ok(()), Ok(st)) if !st.success() => Err(ExportError::Ffmpeg(last_lines(&err_text))),
        (Ok(()), Ok(_)) => std::fs::rename(&tmp, &opts.out).map_err(ExportError::Io),
    };
    if let Err(e) = outcome {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(ExportReport {
        out: opts.out.clone(),
        frames: total,
        encoder,
        audio_layers: audio.len(),
    })
}

fn last_lines(s: &str) -> String {
    let lines: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(5)..].join(" / ")
}

/// 書きかけの置き場（同じフォルダ・`.writing` を足す＝書き終えてから置き換える）。
pub fn writing_path(out: &Path) -> PathBuf {
    let name = out
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "out.mp4".into());
    out.with_file_name(format!(".{name}.writing"))
}

/// 音のレイヤーと、音を持つ映像のレイヤーを、書き出しに混ぜる音へ（MV-0006 決定5）。プレビューの音も同じものを使う。
/// 入れ子の中の音も、外の時刻へずらして入れ子のレイヤーの見える範囲で切って混ぜる（MV-0011 決定4）。
pub fn audio_inputs(
    project: &Project,
    comp: &mv_core::model::Composition,
    project_dir: &Path,
    fps: f64,
    ffmpeg: &Path,
) -> Result<Vec<AudioInput>, ExportError> {
    audio_inputs_at(project, comp, project_dir, fps, ffmpeg, 0)
}

fn audio_inputs_at(
    project: &Project,
    comp: &mv_core::model::Composition,
    project_dir: &Path,
    fps: f64,
    ffmpeg: &Path,
    depth: u32,
) -> Result<Vec<AudioInput>, ExportError> {
    let any_solo = comp.layers.iter().any(|l| l.solo == Some(true));
    let mut v = Vec::new();
    for l in &comp.layers {
        if l.layer_type == LayerType::Precomp {
            if !l.enabled
                || (any_solo && l.solo != Some(true))
                || l.audio.as_ref().is_some_and(|a| a.muted)
            {
                continue;
            }
            if depth + 1 > mv_render::MAX_NEST_DEPTH {
                return Err(ExportError::Render(RenderError::Eval(format!(
                    "「{}」の入れ子が深すぎます（{} 段まで）。",
                    l.name,
                    mv_render::MAX_NEST_DEPTH
                ))));
            }
            let id = l.composition_id.as_deref().unwrap_or_default();
            let inner = project
                .compositions
                .iter()
                .find(|c| c.id == id)
                .ok_or_else(|| ExportError::Render(RenderError::CompositionNotFound(id.into())))?;
            let inner_fps = f64::from(inner.fps.num) / f64::from(inner.fps.den);
            let gain = l
                .audio
                .as_ref()
                .map(|a| mv_core::eval::number_at(&a.volume_db, 0.0))
                .transpose()
                .map_err(|e| ExportError::Render(RenderError::Eval(format!("{e:?}"))))?
                .unwrap_or(0.0);
            // 中の 0 秒＝外の startFrame。見える範囲（書き出しの範囲の中）で切る
            let offset = l.start_frame as f64 / fps;
            let lo = l.in_frame.max(0) as f64 / fps;
            let hi = l.out_frame.min(comp.duration_frames as i64) as f64 / fps;
            let inner_inputs =
                audio_inputs_at(project, inner, project_dir, inner_fps, ffmpeg, depth + 1)?;
            if let Some(remap) = &l.time_remap {
                // タイムリマップ＝中の音をまず中の時刻で混ぜ、それを外の時刻へ並べ直す（MV-0012 決定2）
                if inner_inputs.is_empty() || hi <= lo {
                    continue;
                }
                let inner_dur = f64::from(inner.duration_frames) / inner_fps;
                let key = format!("nested|{inner_inputs:?}|{inner_dur}|{remap:?}|{lo}|{hi}|{fps}");
                let path = remapped_wav(&key, ffmpeg, &inner_inputs, inner_dur, lo, hi, |t| {
                    mv_core::eval::source_sec(comp, l, t * fps)
                })?;
                v.push(AudioInput {
                    path,
                    source_start_sec: 0.0,
                    duration_sec: hi - lo,
                    at_sec: lo,
                    volume_db: gain,
                    channels: 2,
                });
                continue;
            }
            for i in inner_inputs {
                if let Some(c) = place_nested(&i, offset, lo, hi, gain) {
                    v.push(c);
                }
            }
            continue;
        }
        if !matches!(l.layer_type, LayerType::Audio | LayerType::Video)
            || !l.enabled
            || (any_solo && l.solo != Some(true))
            || l.in_frame >= comp.duration_frames as i64
            || !(0..comp.duration_frames as i64).any(|f| is_visible_at(l, f))
        {
            continue;
        }
        let audio = l.audio.as_ref();
        if audio.is_some_and(|a| a.muted) {
            continue;
        }
        let volume_db = audio
            .map(|a| mv_core::eval::number_at(&a.volume_db, 0.0))
            .transpose()
            .map_err(|e| ExportError::Render(RenderError::Eval(format!("{e:?}"))))?
            .unwrap_or(0.0);
        let id = l.asset_id.as_deref().unwrap_or_default();
        let asset = project.assets.iter().find(|a| a.id == id).ok_or_else(|| {
            ExportError::Render(RenderError::Asset(format!(
                "素材（{id}）が見つかりません。"
            )))
        })?;
        let path = match &asset.source {
            AssetSource::Copied { path } => project_dir.join(path),
            AssetSource::Referenced { absolute_path } => PathBuf::from(absolute_path),
        };
        if l.layer_type == LayerType::Video {
            // 映像のレイヤーは、音を持つときだけ（連番は音を持たない）。調べた値が無ければ調べる
            let has_audio = match (asset.kind, asset.meta.as_ref().and_then(|m| m.has_audio)) {
                (AssetKind::ImageSequence, _) => false,
                (_, Some(h)) => h,
                (_, None) => probe_has_audio(ffmpeg, &path)?,
            };
            if !has_audio {
                continue;
            }
        }
        // 見える範囲を書き出しの範囲（0〜長さ）に切る
        let start = l.in_frame.max(0);
        let end = l.out_frame.min(comp.duration_frames as i64);
        let (mut src0, mut dur, mut at) = (
            (start - l.start_frame) as f64 / fps,
            (end - start) as f64 / fps,
            start as f64 / fps,
        );
        if src0 < 0.0 {
            // 素材の始まりより前から見せている＝その間は無音（素材の 0 秒を置く時刻までずらす）
            at -= src0;
            dur += src0;
            src0 = 0.0;
        }
        if dur <= 0.0 {
            continue;
        }
        let channels = match asset.meta.as_ref().and_then(|m| m.channels) {
            Some(c) => c,
            None => probe_channels(ffmpeg, &path)?,
        };
        if let Some(remap) = &l.time_remap {
            // タイムリマップ＝見える範囲の各時刻でリマップの秒の音（MV-0012 決定2）
            let (lo, hi) = (start as f64 / fps, end as f64 / fps);
            if hi <= lo {
                continue;
            }
            let src_dur = match asset.meta.as_ref().and_then(|m| m.duration_sec) {
                Some(d) => d,
                None => {
                    mv_render::media::probe_av(&mv_render::media::ffprobe_beside(ffmpeg), &path)
                        .map_err(ExportError::Render)?
                        .duration_sec
                        .ok_or_else(|| {
                            ExportError::Render(RenderError::Asset(format!(
                            "素材の長さを読めませんでした（{}）。素材を取り込み直してください。",
                            path.display()
                        )))
                        })?
                }
            };
            let src = AudioInput {
                path: path.display().to_string(),
                source_start_sec: 0.0,
                duration_sec: src_dur,
                at_sec: 0.0,
                volume_db: 0.0,
                channels,
            };
            let key = format!("layer|{src:?}|{remap:?}|{lo}|{hi}|{fps}");
            let wav = remapped_wav(&key, ffmpeg, &[src], src_dur, lo, hi, |t| {
                mv_core::eval::source_sec(comp, l, t * fps)
            })?;
            v.push(AudioInput {
                path: wav,
                source_start_sec: 0.0,
                duration_sec: hi - lo,
                at_sec: lo,
                volume_db,
                channels: 2,
            });
            continue;
        }
        v.push(AudioInput {
            path: path.display().to_string(),
            source_start_sec: src0,
            duration_sec: dur,
            at_sec: at,
            volume_db,
            channels,
        });
    }
    Ok(v)
}

/// 混ぜる音の速さ（タイムリマップの音を並べ直すときの標本の速さ）。
pub const REMAP_RATE: u32 = 48_000;

/// 音（ステレオ・左右交互の f32・`rate`）を、外の時刻へ並べ直す（MV-0012 決定2・純粋）。
/// 外の `start_sec` から `frames` 標本ぶん、各標本の時刻 t で素材の `sec_at(t)` 秒の音を、間を直線で補って取る。
/// 素材の範囲の外は無音。速くすれば高く・遅くすれば低く・逆向きなら逆に鳴る（AE と同じ）。
pub fn remap_pcm(
    src: &[f32],
    rate: u32,
    start_sec: f64,
    frames: usize,
    sec_at: impl Fn(f64) -> f64,
) -> Vec<f32> {
    let n = src.len() / 2;
    let r = f64::from(rate);
    let mut out = vec![0.0f32; frames * 2];
    for (i, o) in out.chunks_exact_mut(2).enumerate() {
        let pos = sec_at(start_sec + i as f64 / r) * r;
        if !pos.is_finite() || pos < 0.0 || pos > (n.max(1) - 1) as f64 || n == 0 {
            continue;
        }
        let k = pos.floor() as usize;
        let k1 = (k + 1).min(n - 1);
        let w = (pos - k as f64) as f32;
        for c in 0..2 {
            o[c] = src[k * 2 + c] * (1.0 - w) + src[k1 * 2 + c] * w;
        }
    }
    out
}

/// 32 ビット浮動小数・ステレオの WAV の中身（純粋）。
pub fn wav_f32(rate: u32, pcm: &[f32]) -> Vec<u8> {
    let data_len = (pcm.len() * 4) as u32;
    let mut b = Vec::with_capacity(44 + pcm.len() * 4);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data_len).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&3u16.to_le_bytes()); // 浮動小数
    b.extend_from_slice(&2u16.to_le_bytes());
    b.extend_from_slice(&rate.to_le_bytes());
    b.extend_from_slice(&(rate * 8).to_le_bytes());
    b.extend_from_slice(&8u16.to_le_bytes());
    b.extend_from_slice(&32u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data_len.to_le_bytes());
    for s in pcm {
        b.extend_from_slice(&s.to_le_bytes());
    }
    b
}

/// タイムリマップの音を一時の WAV にする（MV-0012 決定2）。`src` を書き出しと同じ混ぜ方で `src_dur` 秒ほどき、
/// 外の `lo`〜`hi` 秒へ [`remap_pcm`] で並べ直す。中身（`key`）で名前を決めて使い回す。
fn remapped_wav(
    key: &str,
    ffmpeg: &Path,
    src: &[AudioInput],
    src_dur: f64,
    lo: f64,
    hi: f64,
    sec_at: impl Fn(f64) -> Result<f64, mv_core::eval::EvalError>,
) -> Result<String, ExportError> {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    key.hash(&mut h);
    let dir = std::env::temp_dir().join("stario-mv-audio");
    let path = dir.join(format!("{:016x}.wav", h.finish()));
    if path.is_file() {
        return Ok(path.display().to_string());
    }
    // 先に値を求めておく（壊れた値なら知らせる＝黙って無音にしない）
    sec_at(lo).map_err(|e| ExportError::Render(RenderError::Eval(format!("{e:?}"))))?;
    let out = Command::new(ffmpeg)
        .args(mix_args(src, src_dur, REMAP_RATE))
        .stdin(Stdio::null())
        .output()
        .map_err(|e| ExportError::FfmpegNotFound(e.to_string()))?;
    if !out.status.success() {
        return Err(ExportError::Ffmpeg(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    let pcm: Vec<f32> = out
        .stdout
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect();
    let frames = ((hi - lo) * f64::from(REMAP_RATE)).round().max(0.0) as usize;
    let remapped = remap_pcm(&pcm, REMAP_RATE, lo, frames, |t| {
        sec_at(t).unwrap_or(f64::NAN)
    });
    std::fs::create_dir_all(&dir).map_err(ExportError::Io)?;
    // 書きかけを読まれないよう、別の名前に書いてから置き換える
    let tmp = dir.join(format!(
        "{:016x}.{}.writing",
        h.finish(),
        std::process::id()
    ));
    std::fs::write(&tmp, wav_f32(REMAP_RATE, &remapped)).map_err(ExportError::Io)?;
    if let Err(e) = std::fs::rename(&tmp, &path) {
        std::fs::remove_file(&tmp).ok();
        // 同時に作った別の呼び出しが先に置いたなら、それを使う
        if !path.is_file() {
            return Err(ExportError::Io(e));
        }
    }
    Ok(path.display().to_string())
}

/// 入れ子の中の音を外の時刻へ置き直す（`offset` だけ後ろへ・外の `lo`〜`hi` 秒で切る・`gain_db` を足す）。範囲に入らなければ None。
pub fn place_nested(
    i: &AudioInput,
    offset: f64,
    lo: f64,
    hi: f64,
    gain_db: f64,
) -> Option<AudioInput> {
    let at = i.at_sec + offset;
    let start = at.max(lo);
    let end = (at + i.duration_sec).min(hi);
    if end <= start {
        return None;
    }
    Some(AudioInput {
        path: i.path.clone(),
        source_start_sec: i.source_start_sec + (start - at),
        duration_sec: end - start,
        at_sec: start,
        volume_db: i.volume_db + gain_db,
        channels: i.channels,
    })
}

/// プレビューの音＝コンポジション全体を、書き出しと同じ混ぜ方で混ぜた音（ステレオ・`sample_rate`・左右交互の f32）。
/// 音が1つも無ければ None。⚠️ 混ぜ方は [`args::mix_args`]＝書き出しと同じ filter を通す。
pub fn mix_pcm(
    project: &Project,
    composition_id: &str,
    project_dir: &Path,
    ffmpeg: &Path,
    sample_rate: u32,
) -> Result<Option<Vec<f32>>, ExportError> {
    let comp = project
        .compositions
        .iter()
        .find(|c| c.id == composition_id)
        .ok_or_else(|| {
            ExportError::Render(RenderError::CompositionNotFound(composition_id.into()))
        })?;
    let fps = comp.fps.num as f64 / comp.fps.den as f64;
    let audio = audio_inputs(project, comp, project_dir, fps, ffmpeg)?;
    if audio.is_empty() {
        return Ok(None);
    }
    let duration = comp.duration_frames as f64 / fps;
    let out = Command::new(ffmpeg)
        .args(mix_args(&audio, duration, sample_rate))
        .stdin(Stdio::null())
        .output()
        .map_err(|e| ExportError::FfmpegNotFound(e.to_string()))?;
    if !out.status.success() {
        return Err(ExportError::Ffmpeg(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    Ok(Some(
        out.stdout
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect(),
    ))
}

/// 映像の素材が音を持つか（取り込みのときに調べた値が無いとき）。
fn probe_has_audio(ffmpeg: &Path, path: &Path) -> Result<bool, ExportError> {
    mv_render::media::probe_av(&mv_render::media::ffprobe_beside(ffmpeg), path)
        .map(|i| i.audio.is_some())
        .map_err(ExportError::Render)
}

/// 素材の音の数を調べる（取り込みのときに調べた値が無いとき）。⚠️ 読めなければ知らせる（推測で混ぜない）。
pub fn probe_channels(ffmpeg: &Path, path: &Path) -> Result<u32, ExportError> {
    let o = Command::new(ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(path)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| ExportError::FfmpegNotFound(e.to_string()))?;
    let text = String::from_utf8_lossy(&o.stderr);
    parse_channels(&text).ok_or_else(|| {
        ExportError::Render(RenderError::Asset(format!(
            "音の素材を読めませんでした（{}）。素材を取り込み直してください。",
            path.display()
        )))
    })
}

/// `ffmpeg -i` の説明から音の数を読む（純粋）。
pub fn parse_channels(info: &str) -> Option<u32> {
    let line = info.lines().find(|l| l.contains("Audio:"))?;
    let layout = line.split(',').map(str::trim).find(|t| {
        t.contains("mono") || t.contains("stereo") || t.contains("channels") || t.contains('.')
    })?;
    if layout.starts_with("mono") {
        Some(1)
    } else if layout.starts_with("stereo") {
        Some(2)
    } else if let Some(n) = layout
        .split_whitespace()
        .next()
        .and_then(|n| n.parse::<u32>().ok())
        .filter(|_| layout.contains("channels"))
    {
        Some(n)
    } else {
        // 5.1 などの並び（"5.1(side)"）
        layout
            .split(|c: char| !c.is_ascii_digit() && c != '.')
            .next()
            .and_then(|s| {
                let mut it = s.split('.');
                let a: u32 = it.next()?.parse().ok()?;
                let b: u32 = it.next().unwrap_or("0").parse().ok()?;
                Some(a + b)
            })
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_channels, place_nested, remap_pcm, wav_f32, AudioInput};

    #[test]
    fn 音を並べ直す_等速_半分_逆向き_範囲の外は無音() {
        // 左＝0,1,2,3,4（標本ごと）・右＝その 10 倍
        let src: Vec<f32> = (0..5).flat_map(|i| [i as f32, i as f32 * 10.0]).collect();
        let r = 10;
        // 等速：外の 0.1 秒から 3 標本＝素材の 0.1〜0.3 秒
        assert_eq!(
            remap_pcm(&src, r, 0.1, 3, |t| t),
            vec![1.0, 10.0, 2.0, 20.0, 3.0, 30.0]
        );
        // 半分の速さ＝間を直線で補う
        assert_eq!(
            remap_pcm(&src, r, 0.0, 3, |t| t / 2.0),
            vec![0.0, 0.0, 0.5, 5.0, 1.0, 10.0]
        );
        // 逆向き
        assert_eq!(
            remap_pcm(&src, r, 0.0, 3, |t| 0.4 - t),
            vec![4.0, 40.0, 3.0, 30.0, 2.0, 20.0]
        );
        // 範囲の外（負・最後の標本より後・求められない値）は無音
        assert_eq!(remap_pcm(&src, r, 0.0, 1, |_| -0.05), vec![0.0, 0.0]);
        assert_eq!(remap_pcm(&src, r, 0.0, 1, |_| 0.45), vec![0.0, 0.0]);
        assert_eq!(remap_pcm(&src, r, 0.0, 1, |_| f64::NAN), vec![0.0, 0.0]);
        // 最後の標本ちょうどは鳴る
        assert_eq!(remap_pcm(&src, r, 0.0, 1, |_| 0.4), vec![4.0, 40.0]);
        // 空の素材は無音
        assert_eq!(remap_pcm(&[], r, 0.0, 2, |t| t), vec![0.0; 4]);
    }

    #[test]
    fn 浮動小数の_wav_の頭() {
        let b = wav_f32(48_000, &[0.5, -0.5]);
        assert_eq!(b.len(), 44 + 8);
        assert_eq!(&b[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(b[4..8].try_into().unwrap()), 36 + 8);
        assert_eq!(
            u16::from_le_bytes(b[20..22].try_into().unwrap()),
            3,
            "浮動小数"
        );
        assert_eq!(
            u16::from_le_bytes(b[22..24].try_into().unwrap()),
            2,
            "ステレオ"
        );
        assert_eq!(u32::from_le_bytes(b[24..28].try_into().unwrap()), 48_000);
        assert_eq!(
            u32::from_le_bytes(b[28..32].try_into().unwrap()),
            48_000 * 8
        );
        assert_eq!(u16::from_le_bytes(b[32..34].try_into().unwrap()), 8);
        assert_eq!(u16::from_le_bytes(b[34..36].try_into().unwrap()), 32);
        assert_eq!(u32::from_le_bytes(b[40..44].try_into().unwrap()), 8);
        assert_eq!(f32::from_le_bytes(b[44..48].try_into().unwrap()), 0.5);
    }

    fn input(at: f64, dur: f64) -> AudioInput {
        AudioInput {
            path: "a.wav".into(),
            source_start_sec: 1.0,
            duration_sec: dur,
            at_sec: at,
            volume_db: -3.0,
            channels: 1,
        }
    }

    #[test]
    fn 入れ子の音は外の時刻へずらして見える範囲で切る() {
        // 中の 0.2 秒から 1 秒鳴る音を、0.5 秒ずらす＝外の 0.7〜1.7。見える範囲 1.0〜1.5 で切る
        let c = place_nested(&input(0.2, 1.0), 0.5, 1.0, 1.5, -6.0).unwrap();
        assert!((c.at_sec - 1.0).abs() < 1e-9);
        assert!((c.duration_sec - 0.5).abs() < 1e-9);
        assert!(
            (c.source_start_sec - 1.3).abs() < 1e-9,
            "素材も切った分だけ先から"
        );
        assert!(
            (c.volume_db - (-9.0)).abs() < 1e-9,
            "入れ子のレイヤーの音量を足す"
        );
        // 範囲に入らなければ無し
        assert!(place_nested(&input(0.2, 1.0), 0.5, 2.0, 3.0, 0.0).is_none());
        // 切らなくてよいときはそのまま（ずらすだけ）
        let c = place_nested(&input(0.0, 1.0), 2.0, 0.0, 10.0, 0.0).unwrap();
        assert_eq!(
            (c.at_sec, c.duration_sec, c.source_start_sec),
            (2.0, 1.0, 1.0)
        );
    }

    #[test]
    fn 音の数を読む() {
        assert_eq!(parse_channels("  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, mono, s16, 768 kb/s"), Some(1));
        assert_eq!(
            parse_channels("  Stream #0:1(und): Audio: aac (LC), 48000 Hz, stereo, fltp, 320 kb/s"),
            Some(2)
        );
        assert_eq!(
            parse_channels("  Stream #0:0: Audio: flac, 48000 Hz, 5.1(side), s32"),
            Some(6)
        );
        assert_eq!(
            parse_channels("  Stream #0:0: Audio: pcm_s24le, 96000 Hz, 4 channels, s32"),
            Some(4)
        );
        assert_eq!(parse_channels("  Stream #0:0: Video: h264"), None);
    }
}
