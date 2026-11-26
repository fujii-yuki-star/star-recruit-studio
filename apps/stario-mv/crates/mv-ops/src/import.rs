//! 素材の取り込みの下ごしらえ（MV-0006 決定1・2）＝ファイルを調べて、素材の記録と「写すもの」の一覧を作る。
//!
//! ⚠️ ここでは**写さない**。写すのは取引の検査が通ってから（[`crate::Ops`]）＝通らなければ何も残さない。

use mv_core::id::{is_valid_id, new_id, IdKind};
use mv_core::io::ASSETS_DIR;
use mv_render::media;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

/// 拡張子 → 種類（⚠️ 知らない拡張子は取り込まない＝推測で別の種類にしない）。
pub const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"];
pub const SVG_EXT: &[&str] = &["svg"];
pub const VIDEO_EXT: &[&str] = &["mp4", "mov", "m4v", "webm", "mkv", "avi"];
pub const AUDIO_EXT: &[&str] = &["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus"];
/// 連番の fps の既定（AE と同じ）。
pub const DEFAULT_SEQUENCE_FPS: u32 = 30;
/// 連番として数える上限（数え続けて止まらないようにする）。
pub const MAX_SEQUENCE_FRAMES: u64 = 1_000_000;

/// 下ごしらえの結果。
#[derive(Debug, Clone, PartialEq)]
pub struct Planned {
    /// 素材の記録（project.json の `assets` の1つ）。
    pub asset: Value,
    /// 写すもの（元の場所 → 動画のフォルダからの相対の置き場）。参照なら空。
    pub copies: Vec<(PathBuf, String)>,
    /// 知らせること（取り込みは続ける）。
    pub warnings: Vec<String>,
}

fn ext_of(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

/// `importAsset` の1つを調べる。`ffprobe`＝映像・音を調べる道具（無ければ映像・音は取り込めない）。
pub fn plan(op: &Value, ffprobe: Option<&Path>) -> Result<Planned, String> {
    let src = PathBuf::from(op["path"].as_str().unwrap_or_default());
    if !src.is_file() {
        return Err(format!(
            "{} がファイルとして見つかりません。素材のファイルの場所を確かめてください。",
            src.display()
        ));
    }
    let copy = op.get("mode").and_then(Value::as_str) != Some("reference");
    let ext = ext_of(&src);
    let sequence = op.get("sequence").and_then(Value::as_bool) == Some(true);
    let kind = if sequence {
        if !IMAGE_EXT.contains(&ext.as_str()) {
            return Err(format!(
                "連番として取り込めるのは画像のファイルだけです（{} は {ext}）。",
                src.display()
            ));
        }
        "imageSequence"
    } else if IMAGE_EXT.contains(&ext.as_str()) {
        "image"
    } else if SVG_EXT.contains(&ext.as_str()) {
        "svg"
    } else if VIDEO_EXT.contains(&ext.as_str()) {
        "video"
    } else if AUDIO_EXT.contains(&ext.as_str()) {
        "audio"
    } else {
        return Err(format!(
            "「.{ext}」の素材は取り込めません。使える形：画像（{}）・SVG・映像（{}）・音（{}）。",
            IMAGE_EXT.join("・"),
            VIDEO_EXT.join("・"),
            AUDIO_EXT.join("・")
        ));
    };
    let id = match op.get("id").and_then(Value::as_str) {
        Some(id) if is_valid_id(IdKind::Asset, id) => id.to_string(),
        Some(id) => {
            return Err(format!(
                "素材の ID（{id}）の形が違います。newIds で発行するか、省いてください。"
            ))
        }
        None => new_id(IdKind::Asset),
    };
    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("asset")
        .to_string();
    let name = op
        .get("name")
        .and_then(Value::as_str)
        .map(String::from)
        .unwrap_or_else(|| file_name.clone());

    // 連番は、続く番号のファイルを欠けるところまで数える
    let files: Vec<PathBuf> = if sequence {
        if media::split_sequence_name(&src).is_none() {
            return Err(format!(
                "連番の名前の末尾に番号がありません（{}）。shot_0001.png のような名前の先頭のファイルを指定してください。",
                src.display()
            ));
        }
        let mut v = Vec::new();
        for k in 0..MAX_SEQUENCE_FRAMES {
            match media::sequence_path(&src, k) {
                Some(p) if p.is_file() => v.push(p),
                _ => break,
            }
        }
        v
    } else {
        vec![src.clone()]
    };

    let mut warnings = Vec::new();
    let mut meta = Map::new();
    match kind {
        "image" | "imageSequence" => {
            let img = image::open(&src)
                .map_err(|e| format!("画像を読めませんでした（{}・{e}）。", src.display()))?;
            meta.insert("width".into(), json!(img.width()));
            meta.insert("height".into(), json!(img.height()));
            meta.insert("hasAlpha".into(), json!(img.color().has_alpha()));
            if sequence {
                let fps = op
                    .get("fps")
                    .and_then(Value::as_u64)
                    .map(|v| v as u32)
                    .unwrap_or(DEFAULT_SEQUENCE_FPS);
                meta.insert("fps".into(), json!({ "num": fps, "den": 1 }));
                meta.insert("frameCount".into(), json!(files.len()));
            }
        }
        "svg" => {
            let bytes = fs::read(&src)
                .map_err(|e| format!("SVG を読めませんでした（{}・{e}）。", src.display()))?;
            let (w, h) = mv_render::raster::svg_size(&bytes).map_err(|e| e.to_string())?;
            meta.insert("width".into(), json!((w.ceil() as u64).max(1)));
            meta.insert("height".into(), json!((h.ceil() as u64).max(1)));
            meta.insert("hasAlpha".into(), json!(true));
        }
        _ => {
            let ffprobe = ffprobe.ok_or_else(|| {
                "映像・音を調べるには FFmpeg（と同じ場所の ffprobe）が要ります。設定の ffmpeg か環境変数 FFMPEG_PATH で場所を教えてください。".to_string()
            })?;
            let info = media::probe_av(ffprobe, &src).map_err(|e| e.to_string())?;
            if let Some(d) = info.duration_sec {
                meta.insert("durationSec".into(), json!(d));
            }
            if let Some(a) = &info.audio {
                meta.insert("channels".into(), json!(a.channels));
                meta.insert("sampleRate".into(), json!(a.sample_rate));
            }
            if kind == "video" {
                let v = info.video.as_ref().ok_or_else(|| {
                    format!(
                        "{} に映像が入っていません。音だけなら音の拡張子のファイルで取り込んでください。",
                        src.display()
                    )
                })?;
                meta.insert("width".into(), json!(v.width));
                meta.insert("height".into(), json!(v.height));
                meta.insert("fps".into(), json!({ "num": v.fps.0, "den": v.fps.1 }));
                let fps = f64::from(v.fps.0) / f64::from(v.fps.1);
                let count = v.frame_count.or_else(|| {
                    info.duration_sec
                        .map(|d| (d * fps).round() as u64)
                        .filter(|n| *n > 0)
                });
                if let Some(n) = count {
                    meta.insert("frameCount".into(), json!(n));
                }
                meta.insert("hasAlpha".into(), json!(v.has_alpha()));
                meta.insert("hasAudio".into(), json!(info.audio.is_some()));
                if v.variable_rate {
                    warnings.push(format!(
                        "「{name}」はコマの速さが一定でない可能性があります（表示がずれることがあります。一定の速さに変換してから取り込むと確実です）。"
                    ));
                }
            } else if info.audio.is_none() {
                return Err(format!("{} に音が入っていません。", src.display()));
            }
        }
    }

    // 指紋＝連番は全部のコマの名前と中身から1つ
    let mut hasher = Sha256::new();
    for f in &files {
        if sequence {
            hasher.update(f.file_name().and_then(|n| n.to_str()).unwrap_or_default());
        }
        let bytes =
            fs::read(f).map_err(|e| format!("{} を読めませんでした（{e}）。", f.display()))?;
        hasher.update(&bytes);
    }
    let sha: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();

    let (source, copies) = if copy {
        let first = format!("{ASSETS_DIR}/{id}/{file_name}");
        let copies = files
            .iter()
            .map(|f| {
                let n = f.file_name().and_then(|n| n.to_str()).unwrap_or_default();
                (f.clone(), format!("{ASSETS_DIR}/{id}/{n}"))
            })
            .collect();
        (json!({ "mode": "copied", "path": first }), copies)
    } else {
        let abs = src.canonicalize().unwrap_or(src.clone());
        let s = abs.display().to_string();
        let s = s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();
        (
            json!({ "mode": "referenced", "absolutePath": s }),
            Vec::new(),
        )
    };
    Ok(Planned {
        asset: json!({
            "id": id, "kind": kind, "name": name, "source": source, "sha256": sha, "meta": meta,
        }),
        copies,
        warnings,
    })
}

/// 写す（検査が通ってから）。途中で失敗したら、写したものを消して戻す。戻り値＝作ったフォルダ（失敗時の後片付け用）。
pub fn copy_all(dir: &Path, copies: &[(PathBuf, String)]) -> Result<Vec<PathBuf>, String> {
    let mut made: Vec<PathBuf> = Vec::new();
    let result = (|| {
        for (src, rel) in copies {
            let dst = dir.join(rel);
            let parent = dst.parent().map(Path::to_path_buf).unwrap_or_default();
            if !made.contains(&parent) {
                if parent.exists() {
                    return Err(format!(
                        "素材の置き場（{}）がもうあります。別の ID で取り込んでください。",
                        parent.display()
                    ));
                }
                fs::create_dir_all(&parent).map_err(|e| {
                    format!(
                        "素材の置き場を作れませんでした（{}・{e}）。",
                        parent.display()
                    )
                })?;
                made.push(parent);
            }
            fs::copy(src, &dst).map_err(|e| {
                format!(
                    "素材を写せませんでした（{} → {}・{e}）。",
                    src.display(),
                    dst.display()
                )
            })?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => Ok(made),
        Err(e) => {
            remove_all(&made);
            Err(e)
        }
    }
}

/// 写したフォルダを消す（反映できなかったときの後片付け）。
pub fn remove_all(made: &[PathBuf]) {
    for d in made {
        let _ = fs::remove_dir_all(d);
    }
}
