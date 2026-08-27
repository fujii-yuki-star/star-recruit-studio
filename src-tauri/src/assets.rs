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

/// 渡したプロジェクト相対パスのうち、**実体が見つからないもの**を返す（#347）。
///
/// 素材が移動・削除された／別PCへプロジェクトだけ持ち込んだ、を検知するために使う。
/// **見つからないものだけ**を返す（全件の真偽表を返すと、素材が増えるほど無駄が増える）。
/// 安全でない相対パスは「見つからない」として返す（読めないので実質同じ・黙って通さない）。
#[tauri::command]
pub fn missing_asset_files(
    app: tauri::AppHandle,
    project_id: String,
    rel_paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let dir = project_dir(&app, &project_id)?;
    Ok(rel_paths
        .into_iter()
        .filter(|rel| !is_safe_rel_path(rel) || !dir.join(rel).is_file())
        .collect())
}

/// プロジェクト相対パスのファイル（素材・音声）を読み、data URL を返す。
#[tauri::command]
pub fn read_asset_data_url(
    app: tauri::AppHandle,
    project_id: String,
    rel_path: String,
) -> Result<String, String> {
    if !is_safe_rel_path(&rel_path) {
        return Err("不正なパスです。".to_string());
    }
    let path = project_dir(&app, &project_id)?.join(&rel_path);
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let mime = mime_from_path(&rel_path);
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// プロジェクト相対パスがパス構成要素として安全か（パストラバーサル・絶対パス防止）。
///
/// filePath/voicePath は project.json 由来だが、悪意ある共有プロジェクト対策として読む側で毎回検証する。
/// PathBuf::join は絶対パスを渡すとベースを置き換えるため、絶対パス（Windows の `C:\` 含む）も拒否する。
/// **プロジェクト相対パスを受け取る全コマンドがこの1関数を通る**（read_asset_data_url・焼き出しのコピー/容量）
/// ＝どれか一方だけを直して安全条件が静かに乖離するのを防ぐ。
fn is_safe_rel_path(rel_path: &str) -> bool {
    !rel_path.is_empty()
        && !rel_path.contains("..")
        && !rel_path.starts_with('/')
        && !rel_path.starts_with('\\')
        && !Path::new(rel_path).is_absolute()
}

/// 指定したプロジェクト相対ファイルの合計バイト数（焼き出し前の容量提示＝ADR-0032 決定13）。
/// 見つからないファイルは 0 として飛ばす（容量の目安なので、1つ欠けても提示を止めない）。
#[tauri::command]
pub fn project_files_size(
    app: tauri::AppHandle,
    project_id: String,
    rel_paths: Vec<String>,
) -> Result<u64, String> {
    let dir = project_dir(&app, &project_id)?;
    let mut total: u64 = 0;
    for rel in &rel_paths {
        if !is_safe_rel_path(rel) {
            return Err("不正なパスです。".to_string());
        }
        if let Ok(meta) = fs::metadata(dir.join(rel)) {
            total = total.saturating_add(meta.len());
        }
    }
    Ok(total)
}

/// 焼き出し（ADR-0032）でプロジェクト間にファイルをコピーする。
/// 相対パスの構造（assets/…・voices/…）はそのまま保ち、コピー先の親ディレクトリは作る。
/// **元プロジェクトには一切書き込まない**（片道＝決定16）。
#[tauri::command]
pub fn copy_project_files(
    app: tauri::AppHandle,
    src_project_id: String,
    dest_project_id: String,
    rel_paths: Vec<String>,
) -> Result<(), String> {
    if src_project_id == dest_project_id {
        return Err("コピー元とコピー先が同じです。".to_string());
    }
    let src_dir = project_dir(&app, &src_project_id)?;
    let dest_dir = project_dir(&app, &dest_project_id)?;
    for rel in &rel_paths {
        if !is_safe_rel_path(rel) {
            return Err("不正なパスです。".to_string());
        }
        let src = src_dir.join(rel);
        // 元に無いファイルは飛ばす（未配置のサンプル素材など）。欠けたぶんは焼いた側で
        // 「素材が見つかりません」として扱われる（15 §6）＝ここで丸ごと失敗させない。
        if !src.is_file() {
            continue;
        }
        let dest = dest_dir.join(rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|_| ASSET_SAVE_ERR.to_string())?;
        }
        fs::copy(&src, &dest).map_err(|_| ASSET_SAVE_ERR.to_string())?;
    }
    Ok(())
}

/// テンプレ所有素材の保管ディレクトリ <appData>/user_templates/assets（全プロジェクト共通＝ADR-0021）。
fn template_assets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("user_templates").join("assets"))
}

/// テンプレ所有素材(data URL or base64)を <appData>/user_templates/assets/<file_name> に保存する。
/// file_name は <tmpl_asset_NNN>.<ext>（採番は呼び出し側）。sanitize_file_name でパストラバーサル防止。
#[tauri::command]
pub fn import_template_asset(
    app: tauri::AppHandle,
    file_name: String,
    data_base64: String,
) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(strip_data_url(&data_base64))
        .map_err(|_| "素材を読み取れませんでした。もう一度お試しください。".to_string())?;
    let dir = template_assets_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|_| ASSET_SAVE_ERR.to_string())?;
    fs::write(dir.join(sanitize_file_name(&file_name)), &bytes)
        .map_err(|_| ASSET_SAVE_ERR.to_string())?;
    Ok(())
}

/// テンプレ所有素材をすべて読み、(assetId, data URL) の配列で返す（assetId = ファイル名の拡張子なし部分）。
/// 非存在は空。1ファイルの読込失敗で全体を止めない（ログのみ＝load_user_templates と同方針）。
#[tauri::command]
pub fn load_template_assets(app: tauri::AppHandle) -> Result<Vec<(String, String)>, String> {
    let dir = template_assets_dir(&app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<(String, String)> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        // 1エントリの列挙失敗で全体を止めない（既読分は返す・ログのみ＝下のファイル読込スキップと同方針）。
        let path = match entry {
            Ok(e) => e.path(),
            Err(e) => {
                eprintln!("[template_assets] エントリ読み込みスキップ: {}", e);
                continue;
            }
        };
        if !path.is_file() {
            continue;
        }
        let stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        match fs::read(&path) {
            Ok(bytes) => {
                let s = path.to_string_lossy();
                let mime = mime_from_path(&s);
                let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
                out.push((stem, format!("data:{mime};base64,{b64}")));
            }
            Err(e) => eprintln!("[template_assets] 読み込みスキップ {:?}: {}", path, e),
        }
    }
    Ok(out)
}

/// テンプレ所有素材(<asset_id>.*)を削除する（拡張子は問わず stem 一致を消す・無ければ何もしない）。
/// テンプレ削除時の掃除に使う（テンプレ素材は登録テンプレ専用＝ADR-0021）。
#[tauri::command]
pub fn delete_template_asset(app: tauri::AppHandle, asset_id: String) -> Result<(), String> {
    // defense-in-depth：テンプレ所有素材以外の id を弾く（呼び出しミスで他種ファイルを stem 一致で消さない）。
    if !asset_id.starts_with("tmpl_asset_") {
        return Err("不正な素材IDです。".to_string());
    }
    let dir = template_assets_dir(&app)?;
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.file_stem().and_then(|s| s.to_str()) == Some(asset_id.as_str()) {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// プロジェクト相対パスの安全判定（パストラバーサル・絶対パス・空文字）。
    /// read_asset_data_url と焼き出しのコピー/容量が**同じこの関数**を通るので、ここが唯一の網。
    #[test]
    fn rel_path_safety() {
        // 通す：assets/ と voices/ の通常の相対パス（サブディレクトリも可）。
        assert!(is_safe_rel_path("assets/asset_001.png"));
        assert!(is_safe_rel_path("voices/scene_001.wav"));
        assert!(is_safe_rel_path("assets/sub/a.png"));
        // 弾く：親への相対参照（区切りの向きを問わず・途中に現れる場合も）。
        assert!(!is_safe_rel_path(".."));
        assert!(!is_safe_rel_path("../secret.txt"));
        assert!(!is_safe_rel_path("assets/../../secret.txt"));
        assert!(!is_safe_rel_path("assets\\..\\secret.txt"));
        // 弾く：ルート起点（join がベースを置き換える）。
        assert!(!is_safe_rel_path("/etc/passwd"));
        assert!(!is_safe_rel_path("\\Windows\\System32"));
        // 弾く：Windows の絶対パス（ドライブレター・UNC）。
        assert!(!is_safe_rel_path("C:\\Windows\\System32"));
        assert!(!is_safe_rel_path("\\\\server\\share\\a.png"));
        // 弾く：空（プロジェクトフォルダ自身を指す＝ファイルではない）。
        assert!(!is_safe_rel_path(""));
    }

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
