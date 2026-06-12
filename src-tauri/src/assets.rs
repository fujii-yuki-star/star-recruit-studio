// 素材ファイルの取り込み/読み出し（infrastructure 境界）。
// プロジェクトフォルダ <appData>/projects/<id>/assets/ に保管し、Asset.filePath はプロジェクト相対（11 §7.2）。
// 描画は data URL（ADR-0004：canvas汚染回避）なので、読み出しは data URL を返す。
use base64::Engine as _;
use std::fs;
use std::path::PathBuf;
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
    if cleaned.is_empty() {
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
    } else {
        "application/octet-stream"
    }
}

/// 画像(data URL or base64)を <appData>/projects/<id>/assets/<file_name> に保存し、プロジェクト相対パスを返す。
#[tauri::command]
pub fn import_asset(
    app: tauri::AppHandle,
    project_id: String,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(strip_data_url(&data_base64))
        .map_err(|e| format!("画像を読み取れませんでした: {e}"))?;
    let dir = project_dir(&app, &project_id)?.join("assets");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe = sanitize_file_name(&file_name);
    fs::write(dir.join(&safe), bytes).map_err(|e| e.to_string())?;
    Ok(format!("assets/{safe}"))
}

/// プロジェクト相対パスの素材を読み、data URL を返す。
#[tauri::command]
pub fn read_asset_data_url(
    app: tauri::AppHandle,
    project_id: String,
    rel_path: String,
) -> Result<String, String> {
    // パストラバーサル防止（filePath は project.json 由来だが念のため）。
    if rel_path.contains("..") {
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
        assert_eq!(strip_data_url("data:image/png;base64,QQ=="), "QQ==");
        assert_eq!(strip_data_url("QQ=="), "QQ==");
    }

    #[test]
    fn mime_detection() {
        assert_eq!(mime_from_path("assets/x.PNG"), "image/png");
        assert_eq!(mime_from_path("assets/x.jpeg"), "image/jpeg");
        assert_eq!(mime_from_path("assets/x.bin"), "application/octet-stream");
    }
}
