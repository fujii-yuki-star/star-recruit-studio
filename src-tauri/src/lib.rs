// Tauri コマンド。project.json の保存/読込はここ（infrastructure 境界）。
// 保存先は appData/projects/<projectId>/project.json（永続化土台）。
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

mod ai;
mod assets;
mod ffmpeg;
mod voicevox;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// プロジェクト一覧の要約（一覧表示用）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    project_id: String,
    project_name: String,
    updated_at: String,
}

/// appData/projects ディレクトリのパスを返す（作成は呼び出し側）。
fn projects_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("projects"))
}

/// project_id がパス構成要素として安全か（パストラバーサル・区切り防止）。
/// 採番は proj_YYYYMMDD_NNN（英数字と _ のみ）。assets モジュールからも使う。
pub(crate) fn is_safe_project_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// project.json を appData/projects/<projectId>/ に保存し、保存先パスを返す。
#[tauri::command]
fn save_project(app: tauri::AppHandle, project_json: String) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(&project_json).map_err(|e| e.to_string())?;
    let project_id = value
        .get("projectId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "projectId がありません".to_string())?;
    if !is_safe_project_id(project_id) {
        return Err("不正なプロジェクトIDです。".to_string());
    }
    let dir = projects_dir(&app)?.join(project_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("project.json");
    fs::write(&path, &project_json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// appData/projects/<projectId>/project.json を読み、本文を返す。
#[tauri::command]
fn load_project(app: tauri::AppHandle, project_id: String) -> Result<String, String> {
    if !is_safe_project_id(&project_id) {
        return Err("不正なプロジェクトIDです。".to_string());
    }
    let path = projects_dir(&app)?.join(&project_id).join("project.json");
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// 保存済みプロジェクトの要約一覧を更新日時の新しい順で返す。
#[tauri::command]
fn list_projects(app: tauri::AppHandle) -> Result<Vec<ProjectSummary>, String> {
    let dir = projects_dir(&app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<ProjectSummary> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.path().is_dir() {
            continue;
        }
        let Ok(text) = fs::read_to_string(entry.path().join("project.json")) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let get = |key: &str| {
            value
                .get(key)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        out.push(ProjectSummary {
            project_id: get("projectId"),
            project_name: get("projectName"),
            updated_at: get("updatedAt"),
        });
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            save_project,
            load_project,
            list_projects,
            ffmpeg::export_video,
            ffmpeg::probe_video,
            ffmpeg::extract_video_thumbnail,
            assets::import_asset,
            assets::import_asset_bytes,
            assets::import_asset_path,
            assets::import_voice,
            assets::read_asset_data_url,
            voicevox::synthesize_voice,
            ai::save_api_key,
            ai::has_api_key,
            ai::delete_api_key,
            ai::ai_generate
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
