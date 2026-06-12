// FFmpeg 呼び出し（infrastructure 境界）。アプリに静的リンクせず、ffmpeg.exe を外部実行ファイル（sidecar）として呼ぶ。
// バイナリは「環境変数 → 所定フォルダ(<appData>/bin) → PATH」で解決する（ADR-0002 実装方針）。
// コーデックは libopenh264 があればそれ（本番=LGPL）、無ければ libx264（開発=GPL）を自動選択。
// → LGPLビルドを所定フォルダに置くだけで OpenH264 出力へ無改修で切り替わる（コマンド生成は不変）。
// SVG→PNG は ADR-0004（WebView Canvas）で生成。FFmpegは PNG/動画/音声の合成のみ（ADR-0001）。
use base64::Engine as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

// 既定FPS（videoSettings.fps の正典は project.json。B2でフロントから受け取る予定）。
const DEFAULT_FPS: u32 = 30;

/// 映像コーデック。本番(OpenH264)への無改修切替のための抽象。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoCodec {
    OpenH264,
    X264,
}

impl VideoCodec {
    /// FFmpeg の -c:v に渡すエンコーダ名。
    pub fn encoder(self) -> &'static str {
        match self {
            VideoCodec::OpenH264 => "libopenh264",
            VideoCodec::X264 => "libx264",
        }
    }
}

/// `ffmpeg -encoders` の出力から H.264 エンコーダを選ぶ（OpenH264 優先＝本番想定）。
pub fn pick_codec(encoders_output: &str) -> Option<VideoCodec> {
    if encoders_output.contains("libopenh264") {
        Some(VideoCodec::OpenH264)
    } else if encoders_output.contains("libx264") {
        Some(VideoCodec::X264)
    } else {
        None
    }
}

/// 静止画(PNG)を尺ぶん保持して1シーンのMP4にする引数（純粋）。
pub fn still_image_args(
    png: &str,
    out: &str,
    duration_sec: f64,
    fps: u32,
    codec: VideoCodec,
) -> Vec<String> {
    vec![
        "-y".into(),
        "-loop".into(),
        "1".into(),
        "-t".into(),
        format!("{duration_sec}"),
        "-i".into(),
        png.into(),
        "-r".into(),
        format!("{fps}"),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:v".into(),
        codec.encoder().into(),
        out.into(),
    ]
}

/// concat demuxer でシーンMP4を無劣化結合する引数（純粋）。list_file と同じ階層の相対名を参照する。
pub fn concat_args(list_file: &str, out: &str) -> Vec<String> {
    vec![
        "-y".into(),
        "-f".into(),
        "concat".into(),
        "-safe".into(),
        "0".into(),
        "-i".into(),
        list_file.into(),
        "-c".into(),
        "copy".into(),
        out.into(),
    ]
}

/// ffmpeg バイナリを解決（環境変数 → appData/bin → localAppData/bin → PATH）。
pub fn resolve_ffmpeg(app: &tauri::AppHandle) -> PathBuf {
    resolve_bin(app, "FFMPEG_PATH", "ffmpeg")
}

fn resolve_bin(app: &tauri::AppHandle, env_key: &str, name: &str) -> PathBuf {
    if let Ok(p) = std::env::var(env_key) {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    // appData / localAppData の bin/ を順に探す（Windowsの Roaming/Local 差や Tauri のデータ位置差に対応）。
    let file = format!("{name}.exe");
    let dirs = [app.path().app_data_dir(), app.path().app_local_data_dir()];
    for base in dirs.into_iter().flatten() {
        let exe = base.join("bin").join(&file);
        if exe.exists() {
            return exe;
        }
    }
    PathBuf::from(name)
}

/// ffmpeg を実行。成功時 stdout、失敗時 stderr を返す。
pub fn run(bin: &Path, args: &[String]) -> Result<String, String> {
    let out = Command::new(bin)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

struct SceneFile {
    png: PathBuf,
    duration_sec: f64,
}

/// 各シーンPNG → MP4 → concat で1本に結合する（純粋ロジックに近い処理本体）。
fn encode_scenes(
    ffmpeg: &Path,
    scenes: &[SceneFile],
    codec: VideoCodec,
    fps: u32,
    tmp_dir: &Path,
    output: &Path,
) -> Result<(), String> {
    fs::create_dir_all(tmp_dir).map_err(|e| e.to_string())?;
    let mut list = String::new();
    for (i, scene) in scenes.iter().enumerate() {
        let clip_name = format!("scene_{i:03}.mp4");
        let clip = tmp_dir.join(&clip_name);
        let args = still_image_args(
            &scene.png.to_string_lossy(),
            &clip.to_string_lossy(),
            scene.duration_sec,
            fps,
            codec,
        );
        run(ffmpeg, &args).map_err(|e| format!("場面{}のエンコードに失敗: {e}", i + 1))?;
        list.push_str(&format!("file '{clip_name}'\n"));
    }
    let list_path = tmp_dir.join("concat.txt");
    fs::write(&list_path, list).map_err(|e| e.to_string())?;
    let args = concat_args(&list_path.to_string_lossy(), &output.to_string_lossy());
    run(ffmpeg, &args).map_err(|e| format!("場面の結合に失敗: {e}"))?;
    Ok(())
}

/// data URL なら base64 本体だけを取り出す。
fn strip_data_url(s: &str) -> &str {
    if s.starts_with("data:") {
        if let Some(i) = s.find(',') {
            return &s[i + 1..];
        }
    }
    s
}

/// ファイル名から区切り・予約文字を除く（空なら "export"）。
fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    if cleaned.is_empty() {
        "export".to_string()
    } else {
        cleaned
    }
}

/// エクスポートの入力（1場面）。フロントは PNG(base64 or data URL) と尺を渡す。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneInput {
    png_base64: String,
    duration_sec: f64,
}

/// エクスポート結果の要約。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    output_path: String,
    codec: String,
    scene_count: usize,
}

/// 場面PNG群を受け取り、実MP4を output_path に書き出す（H.264/MP4）。
#[tauri::command]
pub fn export_video(
    app: tauri::AppHandle,
    scenes: Vec<SceneInput>,
    file_name: String,
) -> Result<ExportReport, String> {
    if scenes.is_empty() {
        return Err("書き出す場面がありません。".into());
    }
    let ffmpeg = resolve_ffmpeg(&app);
    let encoders = run(&ffmpeg, &["-hide_banner".into(), "-encoders".into()]).map_err(|_| {
        "動画の書き出しツールが見つかりません。設定でツールの場所を指定してください。".to_string()
    })?;
    let codec = pick_codec(&encoders)
        .ok_or_else(|| "この動画形式で書き出せる設定が見つかりません。".to_string())?;

    let tmp = std::env::temp_dir().join("yuko_recruit_export");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    let mut files: Vec<SceneFile> = Vec::with_capacity(scenes.len());
    for (i, s) in scenes.iter().enumerate() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(strip_data_url(&s.png_base64))
            .map_err(|e| format!("場面{}の画像を読み取れませんでした: {e}", i + 1))?;
        let png = tmp.join(format!("scene_{i:03}.png"));
        fs::write(&png, bytes).map_err(|e| e.to_string())?;
        files.push(SceneFile {
            png,
            duration_sec: s.duration_sec,
        });
    }

    // 保存先は <appData>/exports/<安全なファイル名>.mp4（保存先ピッカーは後続）。
    let exports = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("exports");
    fs::create_dir_all(&exports).map_err(|e| e.to_string())?;
    let out = exports.join(format!("{}.mp4", sanitize_file_name(&file_name)));
    encode_scenes(&ffmpeg, &files, codec, DEFAULT_FPS, &tmp, &out)?;

    Ok(ExportReport {
        output_path: out.to_string_lossy().into_owned(),
        codec: codec.encoder().to_string(),
        scene_count: scenes.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_codec_prefers_openh264_then_x264() {
        assert_eq!(
            pick_codec("V..... libopenh264 ... V..... libx264"),
            Some(VideoCodec::OpenH264)
        );
        assert_eq!(pick_codec("V..... libx264 only"), Some(VideoCodec::X264));
        assert_eq!(pick_codec("no h264 here"), None);
    }

    #[test]
    fn still_image_args_uses_selected_encoder() {
        let x = still_image_args("in.png", "out.mp4", 8.0, 30, VideoCodec::X264);
        assert!(x.iter().any(|a| a == "libx264"));
        assert!(x.iter().any(|a| a == "yuv420p"));
        let o = still_image_args("in.png", "out.mp4", 8.0, 30, VideoCodec::OpenH264);
        assert!(o.iter().any(|a| a == "libopenh264"));
    }

    #[test]
    fn concat_args_copies_streams() {
        let a = concat_args("list.txt", "out.mp4");
        assert!(a.iter().any(|s| s == "concat"));
        assert!(a.windows(2).any(|w| w[0] == "-c" && w[1] == "copy"));
    }

    #[test]
    fn strip_data_url_handles_both() {
        assert_eq!(strip_data_url("data:image/png;base64,AAAA"), "AAAA");
        assert_eq!(strip_data_url("AAAA"), "AAAA");
    }

    #[test]
    fn sanitize_file_name_strips_separators_and_defaults() {
        assert_eq!(sanitize_file_name("会社紹介_2026春"), "会社紹介_2026春");
        assert_eq!(sanitize_file_name("a/b\\c:d*?"), "a_b_c_d__");
        assert_eq!(sanitize_file_name("   "), "export");
    }

    // 実FFmpegが要るE2E結合テスト。FFMPEG_PATH 未設定ならスキップ（CIを失敗させない）。
    #[test]
    fn encode_scenes_makes_mp4_when_ffmpeg_available() {
        let Ok(ffmpeg_path) = std::env::var("FFMPEG_PATH") else {
            return;
        };
        let ffmpeg = PathBuf::from(&ffmpeg_path);
        if !ffmpeg.exists() {
            return;
        }
        let tmp = std::env::temp_dir().join("yuko_export_unittest");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let mut scenes = Vec::new();
        for (i, color) in ["red", "blue"].iter().enumerate() {
            let png = tmp.join(format!("src_{i}.png"));
            let gen = vec![
                "-y".to_string(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                format!("color=c={color}:s=320x180"),
                "-frames:v".into(),
                "1".into(),
                png.to_string_lossy().into_owned(),
            ];
            run(&ffmpeg, &gen).expect("generate test png");
            scenes.push(SceneFile {
                png,
                duration_sec: 1.0,
            });
        }
        let encoders = run(&ffmpeg, &["-hide_banner".into(), "-encoders".into()]).unwrap();
        let codec = pick_codec(&encoders).expect("an h264 encoder");
        let out = tmp.join("final.mp4");
        encode_scenes(&ffmpeg, &scenes, codec, 30, &tmp, &out).expect("encode_scenes");
        assert!(fs::metadata(&out).expect("final.mp4 exists").len() > 0);
    }
}
