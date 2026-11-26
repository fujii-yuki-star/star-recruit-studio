//! すたりおMV の画面なしの書き出し（γ0.1 の段階④）。
//!
//! 描画の核（`mv-render`）で1コマずつ描き、生の RGBA を FFmpeg の標準入力へ流して MP4（H.264）にする。
//! ⚠️ プレビューと同じ描画を通す（MV-0002）。⚠️ 中身の検査（2段目）に問題がある動画は書き出さない（黙って別の結果にしない）。
//! ⚠️ 書きかけで止まっても、前からあるファイルを壊さない＝一時ファイルに書いてから置き換える。

pub mod args;

use args::{encode_args, probe_encoder_args, AudioInput, EncodeSpec, H264_ENCODERS};
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

/// 音のレイヤーと、音を持つ映像のレイヤーを、書き出しに混ぜる音へ（MV-0006 決定5）。
fn audio_inputs(
    project: &Project,
    comp: &mv_core::model::Composition,
    project_dir: &Path,
    fps: f64,
    ffmpeg: &Path,
) -> Result<Vec<AudioInput>, ExportError> {
    let any_solo = comp.layers.iter().any(|l| l.solo == Some(true));
    let mut v = Vec::new();
    for l in &comp.layers {
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
    use super::parse_channels;

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
