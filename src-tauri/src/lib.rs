// Tauri コマンド。project.json の保存/読込はここ（infrastructure 境界）。
// 保存先は appData/projects/<projectId>/project.json（永続化土台）。
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

mod ai;
mod assets;
mod ffmpeg;
mod voicevox;
mod voicevox_engine;

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
    /// 文書形式（ADR-0032・11 §1）。タイムライン形式のときだけ "timeline"。
    /// 場面形式は format を書かない（不在＝場面形式）ので、そのまま None を返す＝
    /// 一覧が開く先を選べる（開いてから「形式が違う」と断らずに済む）。
    format: Option<String>,
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

/// テンプレ ID がパス安全かつ正典形式（^[a-z0-9_]+$・小文字のみ）か。user_tmpl_NNN は適合。
/// template.schema.json の templateId 形式（小文字）に合わせ、手動持ち込みの大文字 id を弾く（ADR-0017）。
fn is_safe_template_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
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
            format: value
                .get("format")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        });
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

/// appData/projects/<projectId>/ を丸ごと削除する（プロジェクトの完全削除＝#212）。存在しなくても成功扱い（冪等）。
#[tauri::command]
fn delete_project(app: tauri::AppHandle, project_id: String) -> Result<(), String> {
    if !is_safe_project_id(&project_id) {
        return Err("不正なプロジェクトIDです。".to_string());
    }
    let dir = projects_dir(&app)?.join(&project_id);
    // 冪等：消そうとした瞬間に既に無くても成功扱い（exists→remove の TOCTOU を避け、エラー種別で振り分ける）。
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// appData/user_templates ディレクトリ（ユーザー作成テンプレ・全プロジェクト共通＝ADR-0017）。作成は呼び出し側。
fn user_templates_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("user_templates"))
}

/// ユーザーテンプレ(JSON文字列)を appData/user_templates/<templateId>.json に保存し、保存先パスを返す。
/// templateId は is_safe_template_id（^[a-z0-9_]+$ 小文字）で検証＝パストラバーサル防止＋正典形式。
#[tauri::command]
fn save_user_template(app: tauri::AppHandle, template_json: String) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(&template_json).map_err(|e| e.to_string())?;
    let template_id = value
        .get("templateId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "templateId がありません".to_string())?;
    if !is_safe_template_id(template_id) {
        return Err("不正なテンプレートIDです。".to_string());
    }
    let dir = user_templates_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", template_id));
    fs::write(&path, &template_json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// load_user_templates の結果。jsons=読めた本文／skipped=読めずに飛ばした *.json 数。
/// skipped を返すのは、孤立テンプレ素材の掃除(#299)が「全テンプレが漏れなく揃った」ことを安全条件にするため。
/// read_to_string 失敗を握ってスキップすると、JS 側からは「元々ファイルが無かった」のと区別できず、
/// そのテンプレが所有する素材を孤立と誤判定して消しかねない。skipped>0 を complete=false に落として防ぐ。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UserTemplatesLoad {
    jsons: Vec<String>,
    skipped: usize,
}

/// appData/user_templates の *.json をすべて読み、本文(JSON文字列)＋スキップ数を返す（検証は呼び出し側＝§2-2）。
#[tauri::command]
fn load_user_templates(app: tauri::AppHandle) -> Result<UserTemplatesLoad, String> {
    let dir = user_templates_dir(&app)?;
    if !dir.exists() {
        return Ok(UserTemplatesLoad {
            jsons: Vec::new(),
            skipped: 0,
        });
    }
    let mut out: Vec<String> = Vec::new();
    let mut skipped: usize = 0;
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match fs::read_to_string(&path) {
            Ok(text) => out.push(text),
            // 1ファイルの読込失敗で全体を止めない（権限エラー等は原因究明用にログ）。
            // ただし件数は返す＝在庫が不完全なことを呼び出し側に伝え、掃除(#299)の安全条件に使う。
            Err(e) => {
                skipped += 1;
                eprintln!("[user_templates] 読み込みスキップ {:?}: {}", path, e);
            }
        }
    }
    Ok(UserTemplatesLoad {
        jsons: out,
        skipped,
    })
}

/// ユーザーテンプレ(appData/user_templates/<templateId>.json)を削除する（無ければ何もしない）。
#[tauri::command]
fn delete_user_template(app: tauri::AppHandle, template_id: String) -> Result<(), String> {
    if !is_safe_template_id(&template_id) {
        return Err("不正なテンプレートIDです。".to_string());
    }
    let path = user_templates_dir(&app)?.join(format!("{}.json", template_id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// appData/user_assets ディレクトリ（ユーザー素材ライブラリ・ADR-0035・#260）。作成は呼び出し側。
///
/// ⚠️ **テンプレ既定素材（`user_templates/assets`・ADR-0021）とは別に建てる**＝持ち主も寿命も違う。
/// 同居させると掃除の規則が2つ（テンプレが持つ／利用者が置く）になり、どちらの理由で消せるのかが曖昧になる。
fn user_assets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("user_assets"))
}

/// ライブラリの素材1つぶんの覚え書き（目録＝`user_assets/library.json`）。
///
/// ⚠️ **`lib_asset_NNN` は `project.json` に現れない**（ADR-0035 決定3＝取り込みは「コピー」で
/// `asset_NNN` を採番し直す）ので、`project.schema` は不変。
#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LibraryAsset {
    /// `lib_asset_NNN`（採番は呼び出し側＝ドメイン）。
    id: String,
    /// 保存したファイル名（`<id>.<ext>`）。
    file_name: String,
    /// 画面に出す名前（既定は取り込んだファイルの名前）。
    display_name: String,
    /// 種類（`image`/`video`/`bgm`/`logo`/…＝`project.schema` の `assetType` と同じ語彙）。
    asset_type: String,
    /// タグ（探すときに使う。取り込み時にプロジェクトへ持ち込む＝書き戻さない）。
    #[serde(default)]
    tags: Vec<String>,
}

fn user_assets_manifest(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(user_assets_dir(app)?.join("library.json"))
}

/// 目録を読む（無ければ空）。壊れていたら空として扱う（次の書き込みで直る）。
fn read_library(app: &tauri::AppHandle) -> Result<Vec<LibraryAsset>, String> {
    let path = user_assets_manifest(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(serde_json::from_str::<Vec<LibraryAsset>>(&text).unwrap_or_default())
}

fn write_library(app: &tauri::AppHandle, list: &[LibraryAsset]) -> Result<(), String> {
    let dir = user_assets_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(dir.join("library.json"), text).map_err(|e| e.to_string())
}

/// ライブラリの一覧（目録のうち**実体があるものだけ**）。
///
/// ⚠️ **実体が無い覚え書きは出さない**＝一覧に出ているのに取り込めない、を作らない。
#[tauri::command]
fn list_library_assets(app: tauri::AppHandle) -> Result<Vec<LibraryAsset>, String> {
    let dir = user_assets_dir(&app)?;
    Ok(read_library(&app)?
        .into_iter()
        .filter(|e| dir.join(&e.file_name).exists())
        .collect())
}

/// 素材をライブラリへ置く（利用者が選んだファイルをコピーし、目録に足す）。
///
/// ⚠️ **バイトは JS を経由しない**（ADR-0004・素材の取り込みと同じ流儀）＝パスを受け取って Rust がコピーする。
#[tauri::command]
fn add_library_asset(
    app: tauri::AppHandle,
    asset_id: String,
    display_name: String,
    asset_type: String,
    tags: Vec<String>,
    src_path: String,
) -> Result<LibraryAsset, String> {
    if !is_library_asset_id(&asset_id) {
        return Err("素材を置けませんでした。もう一度お試しください。".to_string());
    }
    let src = PathBuf::from(&src_path);
    if !src.exists() {
        return Err("ファイルが見つかりませんでした。もう一度選び直してください。".to_string());
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_else(|| "bin".to_string());
    let dir = user_assets_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file_name = format!("{asset_id}.{ext}");
    fs::copy(&src, dir.join(&file_name))
        .map_err(|e| format!("素材を置けませんでした。もう一度お試しください。（{e}）"))?;
    let entry = LibraryAsset {
        id: asset_id.clone(),
        file_name,
        display_name: if display_name.trim().is_empty() {
            asset_id
        } else {
            display_name
        },
        asset_type,
        tags,
    };
    let mut list = read_library(&app)?;
    list.retain(|e| e.id != entry.id);
    list.push(entry.clone());
    write_library(&app, &list)?;
    Ok(entry)
}

/// ライブラリの素材を**プロジェクトへコピー**する（ADR-0035 決定3）。
///
/// ⚠️ **参照ではなくコピー**＝ADR-0024 決定6（プロジェクトは自己完結）の例外を増やさない。
/// 別PCへ移しても**全プロジェクトが同時に欠損する**ようなことにならない。
#[tauri::command]
fn copy_library_asset_to_project(
    app: tauri::AppHandle,
    library_asset_id: String,
    project_id: String,
    file_name: String,
) -> Result<String, String> {
    if !is_library_asset_id(&library_asset_id) {
        return Err("素材を取り込めませんでした。もう一度お試しください。".to_string());
    }
    let dir = user_assets_dir(&app)?;
    let entry = read_library(&app)?
        .into_iter()
        .find(|e| e.id == library_asset_id)
        .ok_or_else(|| "この素材は見つかりませんでした。一覧を開き直してください。".to_string())?;
    let src = dir.join(&entry.file_name);
    if !src.exists() {
        return Err("この素材のファイルが見つかりませんでした。置き直してください。".to_string());
    }
    // ⚠️ **保存先の導出は素材の取り込みと同じ関数**（`project_dir`）＝規則を写さない（§2-7）。
    // 名前は「`assets/` の直下に1つ」＝区切りを含む名前は受けない（採番は呼ぶ側＝`asset_NNN`）。
    if !crate::assets::is_safe_single_file_name(&file_name) {
        return Err("素材を取り込めませんでした。もう一度お試しください。".to_string());
    }
    let rel = format!("assets/{file_name}");
    let dest = crate::assets::project_dir(&app, &project_id)?
        .join("assets")
        .join(&file_name);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&src, &dest)
        .map_err(|e| format!("素材を取り込めませんでした。もう一度お試しください。（{e}）"))?;
    Ok(rel)
}

/// ライブラリの素材を消す（実体と目録の両方）。無ければ何もしない。
///
/// ⚠️ **既に取り込んだプロジェクトには影響しない**（コピーなので、向こうは自分のファイルを持っている）。
#[tauri::command]
fn delete_library_asset(app: tauri::AppHandle, asset_id: String) -> Result<(), String> {
    if !is_library_asset_id(&asset_id) {
        return Err("この素材は消せませんでした。".to_string());
    }
    let dir = user_assets_dir(&app)?;
    let list = read_library(&app)?;
    if let Some(e) = list.iter().find(|e| e.id == asset_id) {
        let path = dir.join(&e.file_name);
        if path.exists() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    write_library(
        &app,
        &list
            .into_iter()
            .filter(|e| e.id != asset_id)
            .collect::<Vec<_>>(),
    )
}

/// ライブラリの素材の名前・タグを直す（実体は触らない）。
#[tauri::command]
fn update_library_asset(
    app: tauri::AppHandle,
    asset_id: String,
    display_name: String,
    tags: Vec<String>,
) -> Result<(), String> {
    if !is_library_asset_id(&asset_id) {
        return Err("この素材は直せませんでした。".to_string());
    }
    let mut list = read_library(&app)?;
    let Some(e) = list.iter_mut().find(|e| e.id == asset_id) else {
        return Err("この素材は見つかりませんでした。一覧を開き直してください。".to_string());
    };
    if !display_name.trim().is_empty() {
        e.display_name = display_name;
    }
    e.tags = tags;
    write_library(&app, &list)
}

/// `lib_asset_NNN` の形か（`assetLibrary.ts` の `LIBRARY_ASSET_ID_RE` と一致＝パストラバーサル防止も兼ねる）。
///
/// ⚠️ **同じ規則が2か所にある**（Rust と domain）＝Rust 側はパストラバーサル防止を兼ねるので落とせず、
/// domain 側は採番に要る。**片方だけ変えると保存できるのに読めない**ので、
/// `assetLibrary.test.ts` が**同じ入力で同じ答えになる**ことを固定している（`LIBRARY_ASSET_ID_PATTERN`）。
pub fn is_library_asset_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("lib_asset_") else {
        return false;
    };
    rest.len() >= 3 && rest.chars().all(|c| c.is_ascii_digit())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(voicevox_engine::EngineState::default())
        .setup(|app| {
            // 同梱 VOICEVOX ENGINE を自動起動（同梱が無ければ何もしない＝手動起動/設定の接続先へフォールバック・ADR-0005/#149）。
            voicevox_engine::start_bundled_engine(app.handle());
            // 前回クラッシュ/強制終了で残った書き出しの一時/ステージディレクトリを掃除（#420・非同期・失敗は無視）。
            ffmpeg::cleanup_stale_export_dirs(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            save_project,
            load_project,
            list_projects,
            delete_project,
            save_user_template,
            load_user_templates,
            delete_user_template,
            list_library_assets,
            add_library_asset,
            copy_library_asset_to_project,
            delete_library_asset,
            update_library_asset,
            ffmpeg::export_video,
            ffmpeg::begin_export,
            ffmpeg::cancel_export,
            ffmpeg::stage_export_frame,
            ffmpeg::clear_export_frames_stage,
            ffmpeg::stage_clip_frames,
            ffmpeg::read_export_frame,
            ffmpeg::probe_video,
            ffmpeg::extract_video_thumbnail,
            ffmpeg::detect_h264_capability,
            assets::import_asset,
            assets::import_asset_bytes,
            assets::import_asset_path,
            assets::import_voice,
            assets::read_asset_data_url,
            assets::missing_asset_files,
            assets::delete_project_files,
            assets::project_files_size,
            assets::copy_project_files,
            assets::import_template_asset,
            assets::load_template_assets,
            assets::delete_template_asset,
            voicevox::synthesize_voice,
            ai::save_api_key,
            ai::has_api_key,
            ai::delete_api_key,
            ai::ai_generate
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // アプリ終了時に同梱 ENGINE を確実に終了（ゾンビ化防止・#149）。
            if let tauri::RunEvent::ExitRequested { .. } = event {
                app_handle
                    .state::<voicevox_engine::EngineState>()
                    .shutdown();
                // 書き出し中に閉じても ffmpeg.exe を残さない（orphan 化防止・#380）。
                ffmpeg::cancel_running_export();
            }
        });
}

#[cfg(test)]
mod library_id_tests {
    use super::is_library_asset_id;

    /// ⚠️ **domain 側（`LIBRARY_ASSET_ID_RE`）と同じ答えになること**を、同じ入力で固定する
    /// （PR #887 レビュー 🟡）。入力の一覧は `assetLibrary.ts` の `LIBRARY_ASSET_ID_SAMPLES` と同じ。
    #[test]
    fn matches_domain_rule() {
        let cases: &[(&str, bool)] = &[
            ("lib_asset_001", true),
            ("lib_asset_1000", true),
            ("lib_asset_1", false),
            ("lib_asset_00a", false),
            ("xlib_asset_001", false),
            ("lib_asset_001x", false),
            ("lib_asset_", false),
            ("asset_001", false),
            ("", false),
        ];
        for (id, want) in cases {
            assert_eq!(is_library_asset_id(id), *want, "id={id}");
        }
    }
}
