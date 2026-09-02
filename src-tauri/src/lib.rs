// Tauri コマンド。project.json の保存/読込はここ（infrastructure 境界）。
// 保存先は appData/projects/<projectId>/project.json（永続化土台）。
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

mod ai;
mod assets;
mod ffmpeg;
mod trouble_log;
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
    back_up_previous(&path);
    // ⚠️ **直に上書きしない**（#263）＝書いている最中に落ちると**半端な JSON**が残り、
    // そこから先は読み込みが断り続ける＝**動画がまるごと開けなくなる**。
    // 目録（読み方・フォント・素材・会社の見た目）は既に原子的に書いていたのに、
    // **いちばん大事な動画そのものだけ素の上書き**だった（「双子の片方だけ直す」）。
    write_json_atomic(&path, &project_json)?;
    Ok(path.to_string_lossy().into_owned())
}

/// 前に保存できていたところ（`project.prev.json`）。壊れたときの戻り先。
fn backup_path(project_json: &std::path::Path) -> std::path::PathBuf {
    project_json.with_file_name("project.prev.json")
}

/// いまの `project.json` を「前に保存できていたところ」として控える（#263）。
///
/// ⚠️ **読める版だけ控える**＝壊れた版で控えを上書きすると、**戻り先が無くなる**
/// （壊れたまま開いて保存し直した瞬間に、唯一の良い版が消える）。
/// ⚠️ **控えられなくても保存は続ける**＝控えは「あると助かる」もので、保存を止める理由にならない。
/// ⚠️ **控えも原子的に書く**＝半端な控えは、戻り先として使えないのに在るように見える。
fn back_up_previous(path: &std::path::Path) {
    let Ok(text) = fs::read_to_string(path) else {
        return; // まだ無い＝控えるものが無い
    };
    if serde_json::from_str::<serde_json::Value>(&text).is_err() {
        return; // 壊れている＝控えない（良い控えを潰さない）
    }
    let _ = write_json_atomic(&backup_path(path), &text);
}

/// 復元ポイントの置き場（`projects/<id>/restore/`）。
fn restore_dir(app: &tauri::AppHandle, project_id: &str) -> Result<std::path::PathBuf, String> {
    Ok(projects_dir(app)?.join(project_id).join("restore"))
}

/// 復元ポイントの一覧（ファイル名と、作った時刻＝1970年からのミリ秒）。
///
/// ⚠️ **時刻はファイルの更新時刻から採らない**＝コピーや同期で変わる。**名前に入れて持つ**
/// （`p-<ミリ秒>.json`）＝並べ替えも選び直しも、名前だけで決まる。
/// ⚠️ **どれを残すか・いつ作るかの規則はここに書かない**（`domain/project/restorePoints.ts`）＝
/// 同じ考え方を2か所に置くと、すぐ食い違う。
#[tauri::command]
fn list_restore_points(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<(String, u64)>, String> {
    if !is_safe_project_id(&project_id) {
        return Err("不正なプロジェクトIDです。".to_string());
    }
    let dir = restore_dir(&app, &project_id)?;
    // ⚠️ **「まだ無い」と「読めない」を分ける**（α-7 出口監査 🟡）＝どちらも空にすると、
    // 読めないときにも「編集して保存していくと、少しずつ増えていきます」＝**来ない次の行動**を出す。
    // 無いだけなら空、それ以外は断って `RESTORE_POINTS_UNREADABLE` へ落とす。
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut out = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if let Some(ms) = restore_point_time(&name) {
            out.push((name, ms));
        }
    }
    Ok(out)
}

/// 名前から時刻を読む（`p-<ミリ秒>.json` 以外は復元ポイントとして扱わない）。
fn restore_point_time(name: &str) -> Option<u64> {
    let rest = name.strip_prefix("p-")?.strip_suffix(".json")?;
    rest.parse::<u64>().ok()
}

/// いまの `project.json` を復元ポイントとして控える（作るかどうかは呼び出し側が決める）。
///
/// ⚠️ **読める版だけ**（`back_up_previous` と同じ理由＝戻り先にならないものを増やさない）。
#[tauri::command]
fn take_restore_point(app: tauri::AppHandle, project_id: String, at_ms: u64) -> Result<(), String> {
    if !is_safe_project_id(&project_id) {
        return Err("不正なプロジェクトIDです。".to_string());
    }
    let src = projects_dir(&app)?.join(&project_id).join("project.json");
    let Ok(text) = fs::read_to_string(&src) else {
        return Ok(()); // まだ保存されていない＝控えるものが無い
    };
    if serde_json::from_str::<serde_json::Value>(&text).is_err() {
        return Ok(()); // 壊れている＝戻り先にならない
    }
    let dir = restore_dir(&app, &project_id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_json_atomic(&dir.join(format!("p-{at_ms}.json")), &text)
}

/// 指定の復元ポイントを消す（古いぶんの片づけ＝残す数は呼び出し側が決める）。
#[tauri::command]
fn drop_restore_point(
    app: tauri::AppHandle,
    project_id: String,
    name: String,
) -> Result<(), String> {
    if !is_safe_project_id(&project_id) {
        return Err("不正なプロジェクトIDです。".to_string());
    }
    // ⚠️ **名前を検証する**＝`..` や別のファイルを指されると、関係ないものを消してしまう。
    if restore_point_time(&name).is_none() {
        return Err("不正な復元ポイントです。".to_string());
    }
    let path = restore_dir(&app, &project_id)?.join(&name);
    let _ = fs::remove_file(&path); // 既に無いのは失敗ではない
    Ok(())
}

/// 戻せなかったときの断り（§2-5＝次の行動）。⚠️ **生の OS エラーを画面に出さない**（§2-3）。
const RESTORE_WRITE_FAILED: &str =
    "戻した内容を書き込めませんでした。空き容量を確かめて、もう一度お試しください。";

/// 復元ポイントの中身を読む（戻す前に、いまの内容と見比べるため）。
#[tauri::command]
fn read_restore_point(
    app: tauri::AppHandle,
    project_id: String,
    name: String,
) -> Result<String, String> {
    if !is_safe_project_id(&project_id) {
        return Err("不正なプロジェクトIDです。".to_string());
    }
    if restore_point_time(&name).is_none() {
        return Err("不正な復元ポイントです。".to_string());
    }
    fs::read_to_string(restore_dir(&app, &project_id)?.join(&name)).map_err(|_| {
        "その復元ポイントが見つかりませんでした。一覧から選び直してください。".to_string()
    })
}

/// 戻した内容を書き込む（利用者の明示操作）。
///
/// ⚠️ **いまの内容も消さない**＝書き換える前に復元ポイントとして残す。
/// 「戻したけど、やっぱり戻す前がよかった」に戻れる（取り消しの効かない操作にしない）。
/// ⚠️ **何を書くかは呼び出し側が決める**（#967 レビュー 🟡2）＝戻す内容には
/// **いまの音と食い違う読み上げ**が混じりうるので、そこの手当ては規則を持つ側（domain）で行う。
#[tauri::command]
fn restore_project_text(
    app: tauri::AppHandle,
    project_id: String,
    text: String,
    now_ms: u64,
) -> Result<(), String> {
    if !is_safe_project_id(&project_id) {
        return Err("不正なプロジェクトIDです。".to_string());
    }
    let target = projects_dir(&app)?.join(&project_id).join("project.json");
    if let Ok(cur) = fs::read_to_string(&target) {
        if serde_json::from_str::<serde_json::Value>(&cur).is_ok() {
            let dir = restore_dir(&app, &project_id)?;
            fs::create_dir_all(&dir).map_err(|_| RESTORE_WRITE_FAILED.to_string())?;
            write_json_atomic(&dir.join(format!("p-{now_ms}.json")), &cur)
                .map_err(|_| RESTORE_WRITE_FAILED.to_string())?;
        }
    }
    // ⚠️ **生のエラーをそのまま出さない**（α-7 出口監査 🟡）＝画面は Rust の文字列を優先して出すので、
    // `os error 3` のような**英語の技術詳細**が利用者に見える（§2-3）。次の行動つきの文へ包む。
    write_json_atomic(&target, &text).map_err(|_| RESTORE_WRITE_FAILED.to_string())
}

/// 前に保存できていたところが**いつのものか**（無ければ `None`・1970年からの秒）。
///
/// ⚠️ **黙って差し替えない**（§2-5）＝これは「開けなかったときに、利用者が選んで戻る」ためのもの。
/// 読み込みが自動でこちらへ倒れると、**古い内容の動画を新しいものとして見せる**ことになる。
/// ⚠️ **いつのものかを返す**＝どれだけ巻き戻るかが分からないと、戻すかどうかを決められない。
#[tauri::command]
fn project_backup_time(app: tauri::AppHandle, project_id: String) -> Result<Option<u64>, String> {
    if !is_safe_project_id(&project_id) {
        return Err("不正なプロジェクトIDです。".to_string());
    }
    let path = backup_path(&projects_dir(&app)?.join(&project_id).join("project.json"));
    let Ok(meta) = fs::metadata(&path) else {
        return Ok(None);
    };
    let secs = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    Ok(secs)
}

/// 前に保存できていたところへ戻す（利用者の明示操作）。
///
/// ⚠️ **開けなかったほうも捨てない**＝`project.broken.json` へ寄せて残す。
/// 中身を見れば直せることもあるし、**戻した結果のほうが困る**と分かったときの手がかりになる。
/// ⚠️ **寄せてから書く**＝先に上書きすると、途中で落ちたときに両方失う。
/// ⚠️ **控えは消さない**＝戻した直後にまた壊れても、もう一度戻れる。
#[tauri::command]
fn restore_project_backup(app: tauri::AppHandle, project_id: String) -> Result<(), String> {
    if !is_safe_project_id(&project_id) {
        return Err("不正なプロジェクトIDです。".to_string());
    }
    restore_backup_files(&projects_dir(&app)?.join(&project_id).join("project.json"))
}

/// 戻す手順（ファイルの操作だけ）。
///
/// ⚠️ **切り出してあるのはテストが実装を通るため**＝コマンドは `AppHandle` を要るので、
/// テストから呼べない。手順をテストの中に書き写すと、**実装を壊しても赤くならない**
/// （#396 で同じことをして変異チェックが素通りした）。
fn restore_backup_files(path: &std::path::Path) -> Result<(), String> {
    let bak = backup_path(path);
    let text = fs::read_to_string(&bak).map_err(|_| {
        "前に保存できていたところが見つかりませんでした。一覧から別の動画を選んでください。"
            .to_string()
    })?;
    if path.exists() {
        // ⚠️ **寄せられなかったら書かない**（#964 レビュー 🟡1）＝握りつぶすと、そのまま上書きして
        // **開けなかったほうが一度も残らないまま消える**。「消さない」という約束が、
        // その失敗経路でだけ静かに破れる。**戻せたが手がかりは失った**より、**戻せなかった**と断る。
        fs::rename(path, path.with_file_name("project.broken.json")).map_err(|_| {
            "開けなかったほうを取っておけなかったので、戻していません。".to_string()
        })?;
    }
    write_json_atomic(path, &text)
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

/// 一覧に出すための中身を採る（`project.json` が読めなければ**戻り先**から）。
///
/// ⚠️ **順番に意味がある**＝いまの内容 → 前に保存できていたところ → いちばん新しい復元ポイント。
/// ⚠️ **どれも無ければ `None`**＝戻り先が無いフォルダの行を出しても、押して何もできない。
fn read_project_value(dir: &std::path::Path) -> Option<serde_json::Value> {
    let read = |p: PathBuf| -> Option<serde_json::Value> {
        let text = fs::read_to_string(p).ok()?;
        serde_json::from_str::<serde_json::Value>(&text).ok()
    };
    if let Some(v) = read(dir.join("project.json")) {
        return Some(v);
    }
    if let Some(v) = read(dir.join("project.prev.json")) {
        return Some(v);
    }
    // 復元ポイントは名前に時刻が入っているので、いちばん新しいものを選ぶ。
    let mut points: Vec<(u64, PathBuf)> = fs::read_dir(dir.join("restore"))
        .ok()?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            restore_point_time(&name).map(|ms| (ms, e.path()))
        })
        .collect();
    points.sort_by_key(|(ms, _)| *ms);
    read(points.pop()?.1)
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
        // ⚠️ **読めない動画も、戻り先があるなら行を出す**（α-7 出口監査 🔴）＝
        // 戻す入口（控えから開く・前の状態に戻す）は**一覧の行からしか押せない**ので、
        // ここで飛ばすと **#263 が救おうとした場面（半端な JSON で開けない）がちょうど到達不能**になる。
        // ⚠️ **中身は控えから採る**＝名前が出ないと、どれが自分の動画か分からない。
        // ⚠️ **戻り先が何も無いフォルダは出さない**（押しても何もできない行を作らない）。
        let value = match read_project_value(&entry.path()) {
            Some(v) => v,
            None => continue,
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
    // ⚠️ **こちらも原子的に**（#263）＝半端な見た目パターンは読み込みで却下され、
    // 利用者から見ると**一覧から静かに消える**（#959 と同じ症状になる）。
    write_json_atomic(&path, &template_json)?;
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
                crate::tlog!("user_templates", "読み込みスキップ {:?}: {}", path, e);
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

/// 一覧に出す小さな絵（#397）を保存する。`projects/<id>/preview.png`。
///
/// ⚠️ **失敗しても保存そのものは止めない**（呼ぶ側が投げっぱなしにする）＝
/// 絵が無くても一覧は開ける（プレースホルダで出る）。
#[tauri::command]
fn save_project_thumbnail(
    app: tauri::AppHandle,
    project_id: String,
    data_url: String,
) -> Result<(), String> {
    let dir = crate::assets::project_dir(&app, &project_id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let b64 = data_url.rsplit(',').next().unwrap_or_default();
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64)
        .map_err(|e| e.to_string())?;
    fs::write(dir.join("preview.png"), bytes).map_err(|e| e.to_string())
}
/// appData/readingdict.json（読み方辞書・全プロジェクト共通＝ADR-0037 決定1）。
///
/// ⚠️ **正典はアプリが持つ**＝エンジンを入れ替えても、外部エンジンを指しても同じ読みになる。
/// エンジン側の辞書（`%LOCALAPPDATA%` の voicevox-engine 配下）は**そこへ映したもの**で、
/// OS 上の固定パスを他の VOICEVOX と共有する（`--user_dict_path` に相当するオプションが無い）。
fn reading_dict_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("readingdict.json"))
}

/// 読み方辞書を読む。**無ければ空**（初回起動＝エラーにしない）。検証は呼び出し側（§2-2）。
#[tauri::command]
fn load_reading_dict(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = reading_dict_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| e.to_string())
}

/// 読み方辞書を書く（丸ごと置き換え）。JSON として読めない本文は**書かない**
/// ＝次に開けないファイルを作らない（`save_user_template` と同じ流儀）。
#[tauri::command]
fn save_reading_dict(app: tauri::AppHandle, dict_json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&dict_json).map_err(|e| e.to_string())?;
    let path = reading_dict_path(&app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // ⚠️ **目録と同じく不可分に書く**（PR #909 レビュー ℹ️）＝途中で止まると半端な JSON が残り、
    // 以後 `load_reading_dict` が断り続ける（声も作れなくなる）。失敗の性質が同じなので同じ手を使う。
    write_json_atomic(&path, &dict_json)
}

/// 読み方辞書を、利用者が選んだ場所へ書き出す（ADR-0037 決定8）。
///
/// ⚠️ **汎用の「どこへでも書ける」コマンドにしない**（PR #883 レビュー）＝IPC の口は用途ごとに
/// 狭く保つ。JSON として読めない本文は書かず、拡張子も `.json` に限る（次に読み込めるものだけ作る）。
#[tauri::command]
fn export_reading_dict(path: String, dict_json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&dict_json).map_err(|e| e.to_string())?;
    let p = PathBuf::from(&path);
    if !is_json_path(&p) {
        return Err("読み方の一覧は .json で保存してください。".to_string());
    }
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&p, &dict_json).map_err(|e| e.to_string())
}

/// 読み方辞書を、利用者が選んだファイルから読む（ADR-0037 決定8）。中身の検証は呼び出し側（§2-2）。
#[tauri::command]
fn import_reading_dict(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !is_json_path(&p) {
        return Err("読み方の一覧は .json のファイルを選んでください。".to_string());
    }
    fs::read_to_string(&p).map_err(|e| e.to_string())
}

/// 拡張子が `.json` か（大文字小文字は問わない）。
fn is_json_path(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("json"))
        .unwrap_or(false)
}
/// appData/user_fonts ディレクトリ（持ち込みフォント・ADR-0038・#261）。作成は呼び出し側。
///
/// ⚠️ **プロジェクトには入れない**＝アプリが**再配布経路にならない**ようにする（`13 §6`）。
/// 素材（ADR-0035）は「自己完結のためコピーする」が、フォントは**理由が逆**＝コピーしない。
/// ⚠️ **焼き出し（タイムライン形式）もフォントを運ばない**（同じ PC の中の操作なので、
/// 置き場所が1つあれば足りる）。
fn user_fonts_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("user_fonts"))
}

/// 持ち込みフォント1つぶんの覚え書き（目録＝`user_fonts/fonts.json`）。
#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UserFontEntry {
    /// `user_font_NNN`（採番は呼び出し側＝ドメイン）。
    id: String,
    /// 保存したファイル名（`<id>.<ext>`）。
    file_name: String,
    /// 画面に出す名前（利用者が付ける・既定は元のファイル名）。
    display_name: String,
    /// 外したか（墓標）。⚠️ **番号を使い回さないために覚え書きは残す**（α-6 出口監査 🟡8）＝
    /// 消して行ごと落とすと、次の取り込みで**同じ番号が再発行**され、その番号を指している動画が
    /// **黙って別の字体**になる（`USER_FONT_MISSING` も発火しない）。実体は消す・行だけ残す。
    #[serde(default)]
    removed: bool,
}

fn user_fonts_manifest(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(user_fonts_dir(app)?.join("fonts.json"))
}

/// 目録（`fonts.json` / `library.json`）の本文を**行ごと**に読む（α-6 出口監査 🟡19）。
///
/// ⚠️ **丸ごと捨てない**＝1行が壊れているだけで空にすると、次の書き込みが**棚を空で上書き**し、
/// 置いてあるものの覚え書きが全部消える（実体は残るのに画面から永久に消える＝§2-5）。
/// ⚠️ **配列ですら無いときは断る**＝読めていないものを「空だった」と扱わない。
/// 断ると `add_*`/`delete_*` は書き込む前に止まるので、**壊れたファイルはそのまま残る**。
/// ⚠️ **ただし空のファイルは通す**＝書き込みが途中で止まると 0 バイトで残るので、断ると
/// **開き直しても直らない行き止まり**になる（失う中身が無いので空として扱う）。
fn parse_manifest<T: serde::de::DeserializeOwned>(
    text: &str,
    what: &str,
) -> Result<Vec<T>, String> {
    // ⚠️ **空のファイルは「まだ何も無い」**（再監査で発見）＝書き込みが途中で止まると 0 バイトで残る。
    // ここで断ると**開き直しても直らない**（足す・外すが止まったままで、直す手段が画面に無い＝§2-5 の
    // 行き止まり）。失う中身が無い（1件も書かれていない）ので、空として通して先へ進ませる。
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<serde_json::Value> = serde_json::from_str(text).map_err(|_| {
        format!("{what}の一覧を読めませんでした。中身を失わないよう、足す・外すは止めています。アプリを開き直してください。")
    })?;
    Ok(rows
        .into_iter()
        .filter_map(|r| serde_json::from_value(r).ok())
        .collect())
}

/// 目録から **`id` だけ**を生のまま拾う（採番の入力・差分再監査）。
///
/// ⚠️ **形の合わない行も数える**＝`parse_manifest` が落とした行の番号を再発行しないため。
/// 番号は「使ったことがあるか」だけが要るので、ほかのフィールドは見ない。
fn raw_manifest_ids(path: &std::path::Path, what: &str) -> Result<Vec<String>, String> {
    let from_manifest: Vec<String> = if path.exists() {
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        parse_manifest::<serde_json::Value>(&text, what)?
            .into_iter()
            .filter_map(|v| v.get("id").and_then(|i| i.as_str()).map(str::to_owned))
            .collect()
    } else {
        Vec::new()
    };
    // ⚠️ **実体のファイル名からも番号を起こす**（差分再監査 2巡目）＝目録が**空**（0バイト・
    // 書き込みの中断で残る）だと、覚え書きが無いだけで**実体は残っている**。目録だけを見ると
    // 採番が 001 からやり直しになり、`fs::copy` が**既存の実体を上書き**して、その番号を指している
    // 動画が黙って別のものになる（🟡8 で塞いだ失敗の再現＝#908 の「空は通す」と噛み合う穴）。
    let mut ids = from_manifest;
    if let Some(dir) = path.parent() {
        if let Ok(rd) = fs::read_dir(dir) {
            for e in rd.flatten() {
                // ファイル名の「.」より前が id（`user_font_001.ttf` / `lib_asset_001.png`）。
                if let Some(stem) = e.file_name().to_str().and_then(|n| n.split('.').next()) {
                    if !stem.is_empty() && !ids.iter().any(|i| i == stem) {
                        ids.push(stem.to_owned());
                    }
                }
            }
        }
    }
    Ok(ids)
}

/// 目録を**取り違えないように**書く（差分再監査＝🟡19 の残り）。
///
/// ⚠️ **途中で止まっても壊れた目録を残さない**＝直に上書きすると、書いている最中の中断で
/// **半端な JSON**や 0 バイトのファイルが残る（そこから先は `parse_manifest` が断り続ける）。
/// 隣に書いてから**名前を付け替える**（同じフォルダなので付け替えは1手）。
fn write_json_atomic(path: &std::path::Path, text: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    // ⚠️ **先に消さない**（PR #909 レビュー 🔴）＝`fs::rename` は**既存があっても置き換える**
    //（Windows は `MoveFileEx` の `MOVEFILE_REPLACE_EXISTING`）。消してから付け替えると、
    // その間に落ちたときに**目録が無い瞬間**を自分で作ってしまう（防ぎたかったものと逆）。
    // 実際に置き換えられることは `rename_replaces_existing` で固定してある。
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// 目録を読む（無ければ空）。**壊れた行だけ落とし、配列ですら無ければ断る**（`parse_manifest`）。
fn read_user_fonts(app: &tauri::AppHandle) -> Result<Vec<UserFontEntry>, String> {
    let path = user_fonts_manifest(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    parse_manifest::<UserFontEntry>(&text, "取り込んだ文字の形")
}

fn write_user_fonts(app: &tauri::AppHandle, list: &[UserFontEntry]) -> Result<(), String> {
    let dir = user_fonts_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    write_json_atomic(&dir.join("fonts.json"), &text)
}

/// 持ち込みフォントの一覧（目録のうち**実体があるものだけ**）。
///
/// ⚠️ **実体が無い覚え書きは出さない**＝一覧に出ているのに描けない、を作らない。
/// 消えたフォントを使っている動画には**書き出しの手前で断る**（別の経路・§2-5）。
#[tauri::command]
fn list_user_fonts(app: tauri::AppHandle) -> Result<Vec<UserFontEntry>, String> {
    let dir = user_fonts_dir(&app)?;
    Ok(read_user_fonts(&app)?
        .into_iter()
        .filter(|e| !e.removed && dir.join(&e.file_name).exists())
        .collect())
}

/// **これまでに使った番号**（墓標＝外したものを含む）。採番だけに使う（α-6 出口監査 🟡8）。
///
/// ⚠️ **一覧（`list_user_fonts`）は使えない**＝実体があるものだけを返すので、
/// 最大番号を外すと**同じ番号が再発行**される（その番号を指す動画が黙って別の字体になる）。
/// ⚠️ **壊れた行の番号も拾う**（差分再監査）＝`parse_manifest` は形の合わない行を落とすので、
/// そこから採ると**落ちた行の番号が再発行**され、墓標で塞いだはずの失敗が再現する。
#[tauri::command]
fn used_user_font_ids(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    raw_manifest_ids(&user_fonts_manifest(&app)?, "取り込んだ文字の形")
}

/// フォントを持ち込む（利用者が選んだファイルを `user_fonts/<id>.<ext>` へコピーし、目録に足す）。
#[tauri::command]
fn import_user_font(
    app: tauri::AppHandle,
    font_id: String,
    display_name: String,
    src_path: String,
) -> Result<UserFontEntry, String> {
    if !is_user_font_id(&font_id) {
        return Err("フォントを取り込めませんでした。もう一度お試しください。".to_string());
    }
    let src = PathBuf::from(&src_path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    // ⚠️ **扱える形式だけ受ける**（利用者決定＝4つとも）。それ以外は「読めない字体」になるので先に断る。
    if !matches!(ext.as_str(), "ttf" | "otf" | "woff" | "woff2") {
        return Err("このファイルは文字の形として読み込めません。ttf・otf・woff・woff2 のいずれかを選んでください。".to_string());
    }
    if !src.exists() {
        return Err("ファイルが見つかりませんでした。もう一度選び直してください。".to_string());
    }
    let dir = user_fonts_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file_name = format!("{font_id}.{ext}");
    fs::copy(&src, dir.join(&file_name))
        .map_err(|e| format!("フォントを取り込めませんでした。もう一度お試しください。（{e}）"))?;
    let entry = UserFontEntry {
        id: font_id.clone(),
        file_name,
        display_name: if display_name.trim().is_empty() {
            font_id
        } else {
            display_name
        },
        removed: false,
    };
    let mut list = read_user_fonts(&app)?;
    list.retain(|e| e.id != entry.id);
    list.push(entry.clone());
    write_user_fonts(&app, &list)?;
    Ok(entry)
}

/// フォントの中身（base64）。**WebView へ載せて字を描くために要る**（`FontFace` に渡す）。
///
/// ⚠️ **素材（ADR-0004＝バイトを JS に載せない）とは事情が違う**＝字は WebView が描くので、
/// 中身が WebView に無いと**描きようがない**（`asset://` で読ませる手もあるが、
/// `FontFace` にバイト列を渡す方が読み込みの成否をその場で受け取れる）。
#[tauri::command]
fn read_user_font(app: tauri::AppHandle, font_id: String) -> Result<String, String> {
    if !is_user_font_id(&font_id) {
        return Err("文字の形を読み込めませんでした。".to_string());
    }
    let dir = user_fonts_dir(&app)?;
    let entry = read_user_fonts(&app)?
        .into_iter()
        .find(|e| e.id == font_id)
        .ok_or_else(|| {
            "この文字の形は見つかりませんでした。設定から取り込み直してください。".to_string()
        })?;
    let bytes = fs::read(dir.join(&entry.file_name)).map_err(|_| {
        "この文字の形は見つかりませんでした。設定から取り込み直してください。".to_string()
    })?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &bytes,
    ))
}

/// 持ち込みフォントを消す（実体と目録の両方）。無ければ何もしない。
#[tauri::command]
fn delete_user_font(app: tauri::AppHandle, font_id: String) -> Result<(), String> {
    if !is_user_font_id(&font_id) {
        return Err("この文字の形は消せませんでした。".to_string());
    }
    let dir = user_fonts_dir(&app)?;
    let list = read_user_fonts(&app)?;
    if let Some(e) = list.iter().find(|e| e.id == font_id) {
        let path = dir.join(&e.file_name);
        if path.exists() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    // ⚠️ **行は残す（墓標）**＝番号を使い回さないため（🟡8）。実体は上で消してある。
    write_user_fonts(
        &app,
        &list
            .into_iter()
            .map(|e| {
                if e.id == font_id {
                    UserFontEntry { removed: true, ..e }
                } else {
                    e
                }
            })
            .collect::<Vec<_>>(),
    )
}

/// `user_font_NNN` の形か（`fontCatalog.ts` の `USER_FONT_ID_RE` と一致させる＝パストラバーサル防止も兼ねる）。
fn is_user_font_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("user_font_") else {
        return false;
    };
    rest.len() >= 3 && rest.chars().all(|c| c.is_ascii_digit())
}
/// appData/user_assets ディレクトリ（ユーザー素材ライブラリ・ADR-0035・#260）。作成は呼び出し側。
///
/// ⚠️ **テンプレ既定素材（`user_templates/assets`・ADR-0021）とは別に建てる**＝持ち主も寿命も違う。
/// 同居させると掃除の規則が2つ（テンプレが持つ／利用者が置く）になり、どちらの理由で消せるのかが曖昧になる。
fn user_assets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("user_assets"))
}

/// 画面側の技術詳細を1行残す（#396）。
///
/// ⚠️ **画面側にも同じ穴がある**＝`console.warn`/`console.error` は配布版では**どこにも残らない**
///（WebView のコンソールは見えない）。Rust だけ記録しても、**書き出しの失敗の多くは画面側から始まる**
/// ので原因まで辿れない。受け口を1つ作って、画面側は `console` を包んでここへ流す。
/// ⚠️ **外へは送らない**（§2-6）＝ここも書き出すだけ。
#[tauri::command]
fn trouble_log_record(tag: String, detail: String) {
    trouble_log::record(&tag, &detail);
}

/// うまくいかないときの記録の**置き場**を返す（#396）。画面はここを開くだけ（中身は読まない）。
///
/// ⚠️ **中身を画面へ渡さない**（§2-3）＝入っているのは実装の言葉。渡すのは場所だけにして、
/// 見るかどうか・送るかどうかは利用者が決める（§2-6＝アプリは外へ送らない）。
#[tauri::command]
fn trouble_log_dir() -> Option<String> {
    trouble_log::dir().map(|p| p.to_string_lossy().to_string())
}

/// `assetProtocol.scope` に書いてあるフォルダを作っておく（#945・起動時に1回）。
///
/// ⚠️ **失敗しても起動は止めない**＝作れないのは権限などの環境要因で、ここで落とすと
/// アプリ自体が使えなくなる。作れなければ従来どおり（その回だけ絵が出ない）に留める。
fn ensure_asset_scope_dirs(app: &tauri::AppHandle) {
    use tauri::Manager;
    let scope = app.asset_protocol_scope();
    // ⚠️ **`tauri.conf.json` の `assetProtocol.scope` と同じ広さにする**（PR #946 の自己点検）＝
    // `allow_directory` の第2引数は `true` なら `**`（下の階層も）、`false` なら `*`（直下だけ）を足す。
    // 設定は `projects/**` と `user_assets/*` で**広さが違う**ので、両方 `true` にすると
    // **設定より広く許す**ことになる（`user_assets` は直下しか使わない設計＝#942）。
    for (dir, recursive) in [(projects_dir(app), true), (user_assets_dir(app), false)] {
        let Ok(dir) = dir else { continue };
        // ⚠️ **作るだけでは足りない**＝設定に書いた許可は**起動の組み立て時**に一度だけ広げられるので、
        // そのときフォルダが無いと、あとから作っても許可は増えない（開き直すまで 403）。
        // 実行時に許可を足す口（`allow_directory`）を通す。
        let _ = fs::create_dir_all(&dir);
        let _ = scope.allow_directory(&dir, recursive);
    }
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
    /// 外したか（墓標）。⚠️ **番号を使い回さないために覚え書きは残す**（α-6 出口監査 🟡8・
    /// 持ち込みフォントと同じ扱い＝ADR-0026②）。実体は消す・行だけ残す。
    #[serde(default)]
    removed: bool,
}

fn user_assets_manifest(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(user_assets_dir(app)?.join("library.json"))
}

/// 目録を読む（無ければ空）。**壊れた行だけ落とし、配列ですら無ければ断る**（`parse_manifest`）。
fn read_library(app: &tauri::AppHandle) -> Result<Vec<LibraryAsset>, String> {
    let path = user_assets_manifest(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    parse_manifest::<LibraryAsset>(&text, "よく使う素材")
}

fn write_library(app: &tauri::AppHandle, list: &[LibraryAsset]) -> Result<(), String> {
    let dir = user_assets_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    write_json_atomic(&dir.join("library.json"), &text)
}

/// ライブラリの一覧（目録のうち**実体があるものだけ**）。
///
/// ⚠️ **実体が無い覚え書きは出さない**＝一覧に出ているのに取り込めない、を作らない。
#[tauri::command]
fn list_library_assets(app: tauri::AppHandle) -> Result<Vec<LibraryAsset>, String> {
    let dir = user_assets_dir(&app)?;
    Ok(read_library(&app)?
        .into_iter()
        .filter(|e| !e.removed && dir.join(&e.file_name).exists())
        .collect())
}

/// **これまでに使った番号**（墓標＝外したものを含む）。採番だけに使う（α-6 出口監査 🟡8）。
#[tauri::command]
fn used_library_asset_ids(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    raw_manifest_ids(&user_assets_manifest(&app)?, "よく使う素材")
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
    // ⚠️ **種類も検査する**（α-6 出口監査 ℹ️）＝直す側（`update_library_asset`）は検査するのに、
    // 置く側は素通しだった。知らない種類が入ると読む側が**行ごと落とす**ので、
    // **実体はあるのに棚から消える**（画面から消せない）＝生のまま内部へ流さない（§2-2）。
    if !is_known_asset_type(&asset_type) {
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
        removed: false,
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
    // ⚠️ **行は残す（墓標）**＝番号を使い回さないため（🟡8）。実体は上で消してある。
    write_library(
        &app,
        &list
            .into_iter()
            .map(|e| {
                if e.id == asset_id {
                    LibraryAsset { removed: true, ..e }
                } else {
                    e
                }
            })
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
    asset_type: Option<String>,
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
    // ⚠️ **種類も直せる**（差分再監査）＝**ロゴはファイル名から判らない**（拡張子は写真と同じ）ので、
    // 置いたあとに選ぶしかない。選べないと ADR-0036 の「いつものロゴ」がどこからも設定できない。
    // ⚠️ **知らない値は入れない**＝目録は手で書き換えられるファイルなので、受け側で形を見る（§2-2）。
    if let Some(t) = asset_type {
        if is_known_asset_type(&t) {
            e.asset_type = t;
        }
    }
    e.tags = tags;
    write_library(&app, &list)
}

/// 素材の種類として受けてよい値か（`domain/enums.ts` の `ASSET_TYPES` と同じ一覧）。
///
/// ⚠️ **一覧が2か所にある**（Rust と domain）＝境界で形を見るのに要る。増えたら両方へ足す
///（`is_library_asset_id` と同じ事情）。ずれると `update_library_asset` が**選んだ種類を黙って捨てる**。
///
/// ⚠️ **同値性は `assetLibrary.test.ts` が「この本文を読んで」固定している**（PR #922 レビュー ℹ️）＝
/// 表を両側に置くだけでは、**片方に増やしても相手は赤くならない**（当初そう書いていたが実際には
/// 固定できていなかった）。いまは下の `matches!` の並びをそのまま読んで `ASSET_TYPES` と突き合わせるので、
/// **どちらを増やしても、もう片方を直すまで赤いまま**になる。
/// ⚠️ **書き方を変えるときは向こうの正規表現も直す**（読めなくなったら赤くなる＝空振りで緑にはしない）。
fn is_known_asset_type(v: &str) -> bool {
    matches!(
        v,
        "image" | "video" | "bgm" | "voice" | "yuko" | "decor" | "logo" | "qr"
    )
}

/// `lib_asset_NNN` の形か（`assetLibrary.ts` の `LIBRARY_ASSET_ID_RE` と一致＝パストラバーサル防止も兼ねる）。
///
/// ⚠️ **同じ規則が2か所にある**（Rust と domain）＝Rust 側はパストラバーサル防止を兼ねるので落とせず、
/// domain 側は採番に要る。**片方だけ変えると保存できるのに読めない**ので、
/// `assetLibrary.test.ts` が**同じ入力で同じ答えになる**ことを固定している（`LIBRARY_ASSET_ID_SAMPLES`）。
pub fn is_library_asset_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("lib_asset_") else {
        return false;
    };
    rest.len() >= 3 && rest.chars().all(|c| c.is_ascii_digit())
}

/// appData/brandkit.json（ブランドキット・ADR-0036・#351）。
///
/// ⚠️ **棚を3つ目に増やさない**＝ロゴの実体は素材ライブラリ（`user_assets`・ADR-0035）に置き、
/// キットは `lib_asset_NNN` を**指すだけ**。`appSettings`（`localStorage`）に置かないのは、
/// ファイルが載せられず「会社のブランド」という性質に合わないため。
fn brandkit_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("brandkit.json"))
}

/// ブランドキットを読む。**無ければ空**（初回起動＝エラーにしない）。検証は呼び出し側（§2-2）。
#[tauri::command]
fn load_brand_kit(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = brandkit_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| e.to_string())
}

/// ブランドキットを書く（丸ごと置き換え）。JSON として読めない本文は**書かない**
/// ＝次に開けないファイルを作らない（`save_user_template` と同じ流儀）。
#[tauri::command]
fn save_brand_kit(app: tauri::AppHandle, kit_json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&kit_json).map_err(|e| e.to_string())?;
    let path = brandkit_path(&app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // ⚠️ **不可分に書く**（α-6 出口監査 🟡）＝素の `write` だと、途中で落ちたときに**半端な JSON**が
    // 残る。読む側が「読めなかった」と断るようにしたので、そのまま置くと直す手が無くなる。
    // 目録・読み方辞書と同じ書き方（一時ファイル＋置き換え）へそろえる。
    write_json_atomic(&path, &kit_json)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(voicevox_engine::EngineState::default())
        .setup(|app| {
            // 画像を配れる場所（`assetProtocol.scope`）のフォルダを、**起動時に作っておく**（#945）。
            // ⚠️ **入れたばかりのアプリで、取り込んだ写真がどこにも映らなかった**＝許可は起動時に
            // 組み立てられるのに、`projects` も `user_assets` も**書き込むコマンドの中で初めて作られる**ので、
            // 初回だけ「起動時にフォルダが無い」状態になり、その回の `asset://` が全部 403 になっていた
            //（開き直すと直る＝いちばん気づけない壊れ方。しかも読み込み失敗はその絵を落とすだけなので
            // 知らせも壊れた画像の印も出ない＝§2-5 の行き止まり）。
            // ⚠️ **許可範囲に書いてあるフォルダだけ**を作る＝`user_templates`／`user_fonts` は
            // `asset://` に載っていない（data URL・バイト列で渡す）ので、ここで作ると許可の話と
            // 実際の配り方がずれる。作る対象を増やすときは `tauri.conf.json` の scope と一緒に見ること。
            // うまくいかないときの記録の置き場を作る（#396）。**いちばん先に**＝この後の処理が失敗したら
            // それも残したい（VOICEVOX の起動・書き出しの後片づけ）。
            trouble_log::init(app.handle());
            ensure_asset_scope_dirs(app.handle());
            // 同梱 VOICEVOX ENGINE を自動起動（同梱が無ければ何もしない＝手動起動/設定の接続先へフォールバック・ADR-0005/#149）。
            voicevox_engine::start_bundled_engine(app.handle());
            // 前回クラッシュ/強制終了で残った書き出しの一時/ステージディレクトリを掃除（#420・非同期・失敗は無視）。
            ffmpeg::cleanup_stale_export_dirs(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            save_project,
            project_backup_time,
            restore_project_backup,
            list_restore_points,
            take_restore_point,
            drop_restore_point,
            read_restore_point,
            restore_project_text,
            load_project,
            list_projects,
            delete_project,
            save_user_template,
            load_user_templates,
            delete_user_template,
            save_project_thumbnail,
            load_reading_dict,
            save_reading_dict,
            export_reading_dict,
            import_reading_dict,
            voicevox::voicevox_user_dict_list,
            voicevox::voicevox_user_dict_add,
            voicevox::voicevox_user_dict_update,
            voicevox::voicevox_user_dict_delete,
            voicevox::voicevox_synthesize_with_accent,
            list_user_fonts,
            used_user_font_ids,
            import_user_font,
            read_user_font,
            delete_user_font,
            trouble_log_dir,
            trouble_log_record,
            list_library_assets,
            used_library_asset_ids,
            add_library_asset,
            copy_library_asset_to_project,
            delete_library_asset,
            update_library_asset,
            load_brand_kit,
            save_brand_kit,
            ffmpeg::export_video,
            ffmpeg::begin_export,
            ffmpeg::cancel_export,
            ffmpeg::stage_export_frame,
            ffmpeg::clear_export_frames_stage,
            ffmpeg::stage_clip_frames,
            ffmpeg::read_export_frame,
            ffmpeg::probe_video,
            ffmpeg::extract_video_thumbnail,
            ffmpeg::extract_video_frame,
            ffmpeg::detect_h264_capability,
            assets::import_asset,
            assets::import_asset_bytes,
            assets::import_asset_path,
            assets::import_voice,
            assets::read_asset_data_url,
            assets::missing_asset_files,
            assets::delete_project_files,
            ffmpeg::audio_peaks,
            ffmpeg::video_filmstrip,
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
mod user_font_id_tests {
    use super::is_user_font_id;

    /// ⚠️ **domain 側（`USER_FONT_ID_RE`）と同じ答えになること**を、同じ入力で固定する
    ///（α-6 出口監査 🔴5）。入力の一覧は `fontCatalog.ts` の `USER_FONT_ID_SAMPLES` と同じ。
    ///
    /// ⚠️ **姉妹の `is_library_asset_id` には固定があったのに、こちらだけ空いていた**＝
    /// 片方だけ桁数・接頭辞がずれると「保存できるのに読めない」がテスト無しで入る。
    /// この関数はパストラバーサル防止も兼ねるので、緩む方向のずれは実害が出る。
    #[test]
    fn matches_domain_rule() {
        let cases: &[(&str, bool)] = &[
            ("user_font_001", true),
            ("user_font_1000", true),
            ("user_font_1", false),
            ("user_font_00a", false),
            ("xuser_font_001", false),
            ("user_font_001x", false),
            ("user_font_", false),
            ("gen-interface-jp", false),
            ("", false),
        ];
        for (id, want) in cases {
            assert_eq!(is_user_font_id(id), *want, "id={id}");
        }
    }
}

#[cfg(test)]
mod library_id_tests {
    use super::{is_known_asset_type, is_library_asset_id};

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

    /// 素材の種類の受け入れが domain（`ASSET_TYPE_SAMPLES`）と**同じ答え**になること。
    ///
    /// ⚠️ 一覧が2か所にあるので、片方だけ増やすと **`update_library_asset` が選んだ種類を黙って捨てる**。
    #[test]
    fn asset_type_matches_domain_rule() {
        let cases: &[(&str, bool)] = &[
            ("image", true),
            ("video", true),
            ("bgm", true),
            ("voice", true),
            ("yuko", true),
            ("decor", true),
            ("logo", true),
            ("qr", true),
            ("Image", false),
            ("audio", false),
            ("movie", false),
            ("", false),
        ];
        for (v, want) in cases {
            assert_eq!(is_known_asset_type(v), *want, "{v}");
        }
    }
}

#[cfg(test)]
mod manifest_tests {
    use super::{parse_manifest, raw_manifest_ids, LibraryAsset, UserFontEntry};

    /// ⚠️ **壊れた行だけ落とす**（α-6 出口監査 🟡19）＝1行のせいで棚が空になると、
    /// 次の書き込みが**空で上書き**して置いてあるものの覚え書きが全部消える。
    #[test]
    fn keeps_good_rows_when_one_row_is_broken() {
        let text = r#"[
          {"id":"lib_asset_001","fileName":"a.png","displayName":"ロゴ","assetType":"logo","tags":[]},
          {"id":"lib_asset_002"},
          {"id":"lib_asset_003","fileName":"c.png","displayName":"写真","assetType":"image","tags":[]}
        ]"#;
        let list = parse_manifest::<LibraryAsset>(text, "よく使う素材").expect("読めるはず");
        let ids: Vec<&str> = list.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["lib_asset_001", "lib_asset_003"]);
    }

    /// ⚠️ **空のファイルは通す**（再監査）＝書き込みが途中で止まると 0 バイトで残る。断ると
    /// **開き直しても直らない**（直す手段が画面に無い＝行き止まり）。失う中身が無いので空として扱う。
    #[test]
    fn empty_file_is_no_entries() {
        for text in ["", "   ", "\n"] {
            let list = parse_manifest::<LibraryAsset>(text, "よく使う素材").expect("通るはず");
            assert!(list.is_empty(), "text={text:?}");
        }
    }

    /// ⚠️ **目録が空でも、実体のファイル名から番号を起こす**（PR #911 レビュー 🟡）＝
    /// 目録が 0 バイトで残ると採番が 001 からやり直しになり、`fs::copy` が**既存の実体を上書き**する。
    /// ⚠️ **目録そのもの・一時ファイルは番号にならない**（`fonts` / `library` は正規の形に一致しない）。
    #[test]
    fn raw_ids_recover_from_files_when_manifest_is_empty() {
        use std::fs;
        let dir = std::env::temp_dir().join("stario_raw_ids_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("作れるはず");
        let manifest = dir.join("fonts.json");
        fs::write(&manifest, "").expect("書けるはず"); // 書き込みが途中で止まった状態
        fs::write(dir.join("user_font_001.ttf"), "x").expect("書けるはず");
        fs::write(dir.join("user_font_007.otf"), "x").expect("書けるはず");
        fs::write(dir.join("fonts.json.tmp"), "x").expect("書けるはず"); // 一時ファイル

        let ids = raw_manifest_ids(&manifest, "取り込んだ文字の形").expect("読めるはず");
        assert!(ids.iter().any(|i| i == "user_font_001"), "ids={ids:?}");
        assert!(ids.iter().any(|i| i == "user_font_007"), "ids={ids:?}");
        // 目録そのもの・一時ファイルは「使った番号」ではない（正規の形に一致しないので採番でも無視される）。
        assert!(!ids
            .iter()
            .any(|i| i.starts_with("user_font_") && i != "user_font_001" && i != "user_font_007"));
        let _ = fs::remove_dir_all(&dir);
    }

    /// 読めない動画も、戻り先があるなら一覧に出す（α-7 出口監査 🔴）。
    ///
    /// ⚠️ **戻す入口は一覧の行からしか押せない**ので、ここで飛ばすと
    /// **#263 が救おうとした場面（半端な JSON で開けない）がちょうど到達不能**になる。
    #[test]
    fn read_project_value_falls_back_to_backups() {
        use super::read_project_value;
        use std::fs;
        let dir = std::env::temp_dir().join("stario_list_fallback");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        // 何も無い＝行を出さない（押して何もできない行を作らない）。
        assert!(
            read_project_value(&dir).is_none(),
            "戻り先が無いのに行を出した"
        );

        // 復元ポイントだけある＝いちばん新しいものを使う。
        fs::create_dir_all(dir.join("restore")).unwrap();
        fs::write(dir.join("restore/p-100.json"), r#"{"projectName":"古い"}"#).unwrap();
        fs::write(
            dir.join("restore/p-200.json"),
            r#"{"projectName":"新しい"}"#,
        )
        .unwrap();
        let v = read_project_value(&dir).expect("復元ポイントから採れるはず");
        assert_eq!(
            v.get("projectName").and_then(|x| x.as_str()),
            Some("新しい")
        );

        // 控えがあれば、そちらを優先する。
        fs::write(dir.join("project.prev.json"), r#"{"projectName":"控え"}"#).unwrap();
        let v = read_project_value(&dir).expect("控えから採れるはず");
        assert_eq!(v.get("projectName").and_then(|x| x.as_str()), Some("控え"));

        // いまの内容が読めるなら、それがいちばん優先。
        fs::write(dir.join("project.json"), r#"{"projectName":"いま"}"#).unwrap();
        let v = read_project_value(&dir).expect("いまの内容から採れるはず");
        assert_eq!(v.get("projectName").and_then(|x| x.as_str()), Some("いま"));

        // 半端な JSON は「読めない」＝控えへ落ちる（#263 が名指しする場面）。
        fs::write(dir.join("project.json"), "{半端").unwrap();
        let v = read_project_value(&dir).expect("控えへ落ちるはず");
        assert_eq!(v.get("projectName").and_then(|x| x.as_str()), Some("控え"));

        let _ = fs::remove_dir_all(&dir);
    }

    /// 復元ポイントの名前から時刻を読む（#263 段階2）。
    ///
    /// ⚠️ **これが名前の検証そのもの**＝`drop_restore_point` / `restore_from_point` は
    /// ここが `None` を返すものを断る。緩めると、`..` や関係ないファイルを指されて**別のものを消す**。
    #[test]
    fn restore_point_time_reads_only_our_names() {
        use super::restore_point_time;
        assert_eq!(
            restore_point_time("p-1700000000000.json"),
            Some(1_700_000_000_000)
        );
        assert_eq!(restore_point_time("p-0.json"), Some(0));
        // 形が違うものは復元ポイントとして扱わない。
        for bad in [
            "project.json",
            "p-.json",
            "p-abc.json",
            "p-123.txt",
            "../project.json",
            "p-123.json.tmp",
            "P-123.json",
            "p--1.json",
        ] {
            assert_eq!(restore_point_time(bad), None, "bad={bad}");
        }
    }

    /// 開けなかったほうを取っておけないときは、戻さない（#964 レビュー 🟡1）。
    ///
    /// ⚠️ **握りつぶすと約束が静かに破れる**＝寄せられないままそのまま上書きすると、
    /// 開けなかったほうが**一度も残らないまま消える**。
    /// ここでは寄せ先を**フォルダ**にして rename を失敗させ、書き込みまで進まないことを見る。
    #[test]
    fn restore_stops_when_broken_cannot_be_kept() {
        use super::{backup_path, restore_backup_files, write_json_atomic};
        use std::fs;
        let dir = std::env::temp_dir().join("stario_restore_stops");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("project.json");
        fs::write(&path, "{半端").unwrap();
        write_json_atomic(&backup_path(&path), r#"{"projectId":"p_001"}"#).unwrap();
        // 寄せ先を先に**フォルダ**として作っておく＝rename は失敗する。
        fs::create_dir_all(dir.join("project.broken.json")).unwrap();

        assert!(restore_backup_files(&path).is_err(), "失敗を握りつぶした");
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "{半端",
            "戻せていないのに上書きした（開けなかったほうが消える）"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 戻したとき、**開けなかったほうも残る**（#263）。
    ///
    /// ⚠️ **捨てると手がかりが無くなる**＝中身を見れば直せることもあり、
    /// 「戻した結果のほうが困る」と分かったときに戻る先も無くなる。
    /// ⚠️ **控えも残す**＝戻した直後にまた壊れても、もう一度戻れる。
    #[test]
    fn restore_keeps_broken_and_backup() {
        use super::{backup_path, write_json_atomic};
        use std::fs;
        let dir = std::env::temp_dir().join("stario_restore_keeps");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("project.json");
        let bak = backup_path(&path);
        fs::write(&path, "{半端").unwrap();
        write_json_atomic(&bak, r#"{"projectId":"p_001"}"#).unwrap();

        super::restore_backup_files(&path).expect("戻せるはず");

        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            r#"{"projectId":"p_001"}"#
        );
        assert_eq!(
            fs::read_to_string(dir.join("project.broken.json")).unwrap(),
            "{半端",
            "開けなかったほうを捨てた"
        );
        assert!(bak.exists(), "控えまで消した");
        let _ = fs::remove_dir_all(&dir);
    }

    /// 前に保存できていたところを控える（#263）。
    ///
    /// ⚠️ **壊れた版で控えを潰さない**＝ここが破れると、壊れたまま開いて保存し直した瞬間に
    /// **唯一の良い版が消える**（戻り先が無くなる）。
    #[test]
    fn back_up_previous_keeps_only_readable() {
        use super::{back_up_previous, backup_path};
        use std::fs;
        let dir = std::env::temp_dir().join("stario_backup_keeps_only_readable");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("project.json");
        let bak = backup_path(&path);

        // まだ無い＝控えない（空の控えを作らない）。
        back_up_previous(&path);
        assert!(!bak.exists(), "無いものを控えた");

        // 読める版＝控える。
        fs::write(&path, r#"{"projectId":"p_001"}"#).unwrap();
        back_up_previous(&path);
        assert_eq!(
            fs::read_to_string(&bak).unwrap(),
            r#"{"projectId":"p_001"}"#
        );

        eprintln!(
            "DBG after-good: {:?}",
            fs::read_dir(&dir)
                .unwrap()
                .map(|e| e.unwrap().file_name())
                .collect::<Vec<_>>()
        );
        // 壊れた版＝控えない（良い控えがそのまま残る）。
        fs::write(&path, "{半端").unwrap();
        back_up_previous(&path);
        assert_eq!(
            fs::read_to_string(&bak).unwrap(),
            r#"{"projectId":"p_001"}"#,
            "壊れた版で控えを潰した"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// ⚠️ **`rename` は既存を置き換える**（PR #909 レビュー 🔴・この環境で実際に確かめる）＝
    /// 「Windows は上書きできない」は誤りで、先に消すと**目録が無い瞬間**を自分で作ってしまう。
    #[test]
    fn rename_replaces_existing() {
        use std::fs;
        let dir = std::env::temp_dir().join("stario_rename_test");
        let _ = fs::create_dir_all(&dir);
        let target = dir.join("m.json");
        let tmp = dir.join("m.json.tmp");
        fs::write(&target, "old").expect("書けるはず");
        fs::write(&tmp, "new").expect("書けるはず");
        fs::rename(&tmp, &target).expect("既存があっても置き換えられるはず");
        assert_eq!(fs::read_to_string(&target).expect("読めるはず"), "new");
        assert!(!tmp.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// ⚠️ **採番の入力は壊れた行の番号も拾う**（差分再監査）＝`parse_manifest` が落とした行から
    /// 採ると**その番号が再発行**され、墓標で塞いだ「同じ番号が別のものを指す」が再現する。
    #[test]
    fn raw_ids_include_broken_rows() {
        let text = r#"[
          {"id":"lib_asset_001","fileName":"a.png","displayName":"ロゴ","assetType":"logo","tags":[]},
          {"id":"lib_asset_009"},
          {"noId":true}
        ]"#;
        let ids: Vec<String> = parse_manifest::<serde_json::Value>(text, "よく使う素材")
            .expect("読めるはず")
            .into_iter()
            .filter_map(|v| v.get("id").and_then(|i| i.as_str()).map(str::to_owned))
            .collect();
        // 形の合わない `lib_asset_009` も番号として数える（落とすと再発行される）。
        assert_eq!(ids, vec!["lib_asset_001", "lib_asset_009"]);
    }

    /// ⚠️ **配列ですら無いときは断る**＝「空だった」と扱うと書き込みが走って壊れたファイルを上書きする。
    #[test]
    fn refuses_when_not_a_list() {
        let err = match parse_manifest::<UserFontEntry>("こわれた", "取り込んだ文字の形")
        {
            Ok(_) => panic!("断るはず"),
            Err(e) => e,
        };
        assert!(err.contains("取り込んだ文字の形"), "err={err}");
        // §2-5＝次の行動を示す。
        assert!(err.contains("開き直して"), "err={err}");
    }

    /// 墓標（`removed`）は既定 false ＝**前の版の目録もそのまま読める**（🟡8）。
    #[test]
    fn removed_defaults_to_false() {
        let text = r#"[{"id":"user_font_001","fileName":"a.ttf","displayName":"手持ちの字"}]"#;
        let list = parse_manifest::<UserFontEntry>(text, "取り込んだ文字の形").expect("読めるはず");
        assert!(!list[0].removed);
    }
}
