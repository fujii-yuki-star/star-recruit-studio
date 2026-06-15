// プロジェクトのファイル（素材画像・ナレーション音声）の取り込み/読み出し（infrastructure 境界）。
// プロジェクトフォルダ <appData>/projects/<id>/{assets,voices}/ に保管し、相対パスを project.json に持つ（11 §7.2）。
// 描画は data URL（ADR-0004：canvas汚染回避）なので、読み出しは data URL を返す（音声も同形式で復元）。
use base64::Engine as _;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

fn project_dir(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    if !crate::is_safe_project_id(project_id) {
        return Err("不正なプロジェクトIDです。".to_string());
    }
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("projects").join(project_id))
}

// data URL なら base64 本体だけを取り出す（小ユーティリティ。ffmpeg.rs と同等）。
fn strip_data_url(s: &str) -> &str {
    if s.starts_with("data:") {
        if let Some(i) = s.find(',') {
            return &s[i + 1..];
        }
    }
    s
}

// ファイル名から区切り・予約文字を除く（空なら "asset"）。
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
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "asset".to_string()
    } else {
        cleaned
    }
}

fn mime_from_path(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".mp4") || lower.ends_with(".m4v") {
        "video/mp4"
    } else if lower.ends_with(".mov") {
        "video/quicktime"
    } else if lower.ends_with(".webm") {
        "video/webm"
    } else if lower.ends_with(".avi") {
        "video/x-msvideo"
    } else if lower.ends_with(".mkv") {
        "video/x-matroska"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if lower.ends_with(".m4a") {
        "audio/mp4"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else {
        "application/octet-stream"
    }
}

// 素材の保存失敗時のユーザー向け文言（§2-5：次の行動を示す。1か所に集約）。
const ASSET_SAVE_ERR: &str = "素材の保存に失敗しました。ディスクの空き容量を確認してください。";

/// assets/ ディレクトリを用意し、(保存先の絶対パス, プロジェクト相対パス) を返す（write/copy 共通）。
fn asset_dest(
    app: &tauri::AppHandle,
    project_id: &str,
    file_name: &str,
) -> Result<(PathBuf, String), String> {
    let dir = project_dir(app, project_id)?.join("assets");
    fs::create_dir_all(&dir).map_err(|_| ASSET_SAVE_ERR.to_string())?;
    let safe = sanitize_file_name(file_name);
    Ok((dir.join(&safe), format!("assets/{safe}")))
}

/// 素材バイト列を <appData>/projects/<id>/assets/<file_name> に保存し、プロジェクト相対パスを返す。
fn write_asset(
    app: &tauri::AppHandle,
    project_id: &str,
    file_name: &str,
    bytes: &[u8],
) -> Result<String, String> {
    let (dest, rel) = asset_dest(app, project_id, file_name)?;
    fs::write(&dest, bytes).map_err(|_| ASSET_SAVE_ERR.to_string())?;
    Ok(rel)
}

/// 元ファイルのパスから assets/<file_name> へコピーし、プロジェクト相対パスを返す。
/// バイトを JS に載せずに取り込む経路（ネイティブの「開く」ダイアログで得た絶対パスを受け取る）。
#[tauri::command]
pub fn import_asset_path(
    app: tauri::AppHandle,
    project_id: String,
    file_name: String,
    src_path: String,
) -> Result<String, String> {
    // 相対参照(..)は拒否（read_asset_data_url と同じ defense-in-depth。直接 invoke 対策）。
    if src_path.contains("..") {
        return Err("不正なパスです。".to_string());
    }
    let src = PathBuf::from(&src_path);
    // 元ファイルが実在する通常ファイルか確認（ダイアログ経由なら満たすが防御）。
    if !src.is_file() {
        return Err("選んだファイルが見つかりませんでした。もう一度お選びください。".to_string());
    }
    let (dest, rel) = asset_dest(&app, &project_id, &file_name)?;
    fs::copy(&src, &dest).map_err(|_| ASSET_SAVE_ERR.to_string())?;
    Ok(rel)
}

/// 画像(data URL or base64)を assets/ に保存し相対パスを返す（画像・BGM など data URL 経路用）。
#[tauri::command]
pub fn import_asset(
    app: tauri::AppHandle,
    project_id: String,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(strip_data_url(&data_base64))
        .map_err(|e| format!("素材を読み取れませんでした: {e}"))?;
    write_asset(&app, &project_id, &file_name, &bytes)
}

/// 素材を生バイト(raw IPC body)で受けて assets/ に保存する（大きい動画を base64 化せずメモリ節約）。
/// body=生バイト、projectId/fileName はヘッダで受け取る。
#[tauri::command]
pub fn import_asset_bytes(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("素材を読み取れませんでした。もう一度お試しください。".to_string());
    };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok());
    let project_id = header("projectId").ok_or_else(|| "不正なリクエストです。".to_string())?;
    let file_name = header("fileName").ok_or_else(|| "不正なリクエストです。".to_string())?;
    write_asset(&app, project_id, file_name, bytes)
}

/// ナレーション音声(WAV; data URL or base64)を <appData>/projects/<id>/voices/<scene_id>.wav に保存し、相対パスを返す。
#[tauri::command]
pub fn import_voice(
    app: tauri::AppHandle,
    project_id: String,
    scene_id: String,
    data_base64: String,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(strip_data_url(&data_base64))
        .map_err(|_| "音声を保存できませんでした。もう一度お試しください。".to_string())?;
    let dir = project_dir(&app, &project_id)?.join("voices");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe = format!("{}.wav", sanitize_file_name(&scene_id));
    fs::write(dir.join(&safe), bytes).map_err(|e| e.to_string())?;
    Ok(format!("voices/{safe}"))
}

/// プロジェクト相対パスのファイル（素材・音声）を読み、data URL を返す。
#[tauri::command]
pub fn read_asset_data_url(
    app: tauri::AppHandle,
    project_id: String,
    rel_path: String,
) -> Result<String, String> {
    // パストラバーサル/絶対パス防止（filePath は project.json 由来だが、悪意ある共有プロジェクト対策）。
    // PathBuf::join は絶対パスを渡すとベースを置き換えるため、絶対パス（Windows の C:\ 含む）も拒否する。
    if rel_path.contains("..")
        || rel_path.starts_with('/')
        || rel_path.starts_with('\\')
        || Path::new(&rel_path).is_absolute()
    {
        return Err("不正なパスです。".to_string());
    }
    let path = project_dir(&app, &project_id)?.join(&rel_path);
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let mime = mime_from_path(&rel_path);
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_and_strip() {
        assert_eq!(sanitize_file_name("a/b:c.png"), "a_b_c.png");
        assert_eq!(sanitize_file_name("   "), "asset");
        assert_eq!(sanitize_file_name(".."), "asset");
        assert_eq!(strip_data_url("data:image/png;base64,QQ=="), "QQ==");
        assert_eq!(strip_data_url("QQ=="), "QQ==");
    }

    #[test]
    fn mime_detection() {
        assert_eq!(mime_from_path("assets/x.PNG"), "image/png");
        assert_eq!(mime_from_path("assets/x.jpeg"), "image/jpeg");
        assert_eq!(mime_from_path("voices/scene_001.wav"), "audio/wav");
        assert_eq!(mime_from_path("assets/bgm_001.mp3"), "audio/mpeg");
        assert_eq!(mime_from_path("assets/clip.MP4"), "video/mp4");
        assert_eq!(mime_from_path("assets/clip.m4v"), "video/mp4");
        assert_eq!(mime_from_path("assets/clip.mov"), "video/quicktime");
        assert_eq!(mime_from_path("assets/clip.webm"), "video/webm");
        assert_eq!(mime_from_path("assets/clip.avi"), "video/x-msvideo");
        assert_eq!(mime_from_path("assets/clip.mkv"), "video/x-matroska");
        assert_eq!(mime_from_path("assets/x.bin"), "application/octet-stream");
    }
}
