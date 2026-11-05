// あなた向け会社説明の一時の動画（β・ADR-0061 決定5・`11 §7.9`）の置き場所。
//
// 置き場所は `<appData>/temporary-sessions/<projectId>/`（通常の動画の一覧＝`projects/` には出さない）。
// 中身は通常の動画と同じ形（`project.json`・`assets/`・`voices/`）＝**場面編集・仕上がり確認・書き出しの道をそのまま通る**
//（動画のフォルダを決める口 `assets::project_dir` が、ここも見る）。
//
// ⚠️ **消すのはこの置き場所の中だけ**（原本・素材の棚・見た目パターン・登録には触らない）。
// ⚠️ **作ってから 24 時間で消す**（一時の動画も、書き出した物も＝同じフォルダに置く）。
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// 置き場所の名前（`appData` の直下）。
pub const SESSIONS_DIR_NAME: &str = "temporary-sessions";
/// 作った時刻を書いておく札（フォルダの更新時刻は中を書くたびに動くので使わない）。
const MARKER_FILE: &str = "session.json";
/// 作ってから消すまで（ADR-0061 判断1）。
pub const SESSION_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

pub fn sessions_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join(SESSIONS_DIR_NAME))
}

/// 動画のフォルダ（`appData` からの相対で決める純粋な部分）。
///
/// ⚠️ **通常の動画が先**＝`projects/<id>` が在ればそちら。無くて `temporary-sessions/<id>` が在ればそちら。
/// どちらも無ければ `projects/<id>`（新しく作る通常の動画）。
/// ＝一時の動画のために、**通常の動画の置き場所が別の所へ向くことは無い**。
pub fn resolve_project_dir(app_data: &Path, project_id: &str) -> PathBuf {
    let normal = app_data.join("projects").join(project_id);
    if normal.exists() {
        return normal;
    }
    let temporary = app_data.join(SESSIONS_DIR_NAME).join(project_id);
    if temporary.is_dir() {
        return temporary;
    }
    normal
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 作った時刻（1970 年からのミリ秒）。札が無い・読めないときはフォルダの更新時刻。どちらも無ければ None。
fn created_ms(dir: &Path) -> Option<u64> {
    if let Ok(text) = fs::read_to_string(dir.join(MARKER_FILE)) {
        if let Some(ms) = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.get("createdAtMs").and_then(|x| x.as_u64()))
        {
            return Some(ms);
        }
    }
    fs::metadata(dir)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

/// 一時の動画のフォルダを作る（純粋な部分）。番号は画面が決める（採番の規則は `11.2`＝ドメイン）。
///
/// ⚠️ **どちらかの置き場所に同じ番号が在れば断る**（別の動画を黙って潰さない・ADR-0026④）。
pub fn create_in(app_data: &Path, project_id: &str, now: u64) -> Result<(), String> {
    if !crate::is_safe_project_id(project_id) {
        return Err(crate::messages::PROJECT_UNUSABLE.to_string());
    }
    let normal = app_data.join("projects").join(project_id);
    let dir = app_data.join(SESSIONS_DIR_NAME).join(project_id);
    if normal.exists() || dir.exists() {
        return Err(crate::messages::BRIEFING_SESSION_ID_TAKEN.to_string());
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let marker = serde_json::json!({ "createdAtMs": now }).to_string();
    if let Err(e) = fs::write(dir.join(MARKER_FILE), marker) {
        let _ = fs::remove_dir_all(&dir);
        return Err(e.to_string());
    }
    Ok(())
}

/// いま在る一時の動画の番号（採番で重ならないように画面が使う）。置き場所が無ければ空。
pub fn list_in(app_data: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(app_data.join(SESSIONS_DIR_NAME)) else {
        return Vec::new();
    };
    let mut out: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| crate::is_safe_project_id(n))
        .collect();
    out.sort();
    out
}

/// 一時の動画を1つ消す（「この回のデータを消す」）。無ければ何もしない。
///
/// ⚠️ **この置き場所の中だけ**＝番号を検査し、`temporary-sessions/<id>` だけを消す（`projects/` は見ない）。
pub fn delete_in(app_data: &Path, project_id: &str) -> Result<(), String> {
    if !crate::is_safe_project_id(project_id) {
        return Err(crate::messages::PROJECT_UNUSABLE.to_string());
    }
    let dir = app_data.join(SESSIONS_DIR_NAME).join(project_id);
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// 作ってから `max_age` を過ぎた一時の動画を消す。消した数を返す。
///
/// ⚠️ **この置き場所の直下のフォルダだけ**＝ファイルや、番号の形でない名前は触らない。
/// ⚠️ **作った時刻が分からないものは消さない**（読めない＝古いとは限らない）。
pub fn cleanup_in(app_data: &Path, now: u64, max_age: Duration) -> usize {
    let Ok(entries) = fs::read_dir(app_data.join(SESSIONS_DIR_NAME)) else {
        return 0;
    };
    let limit = max_age.as_millis() as u64;
    let mut removed = 0;
    for e in entries.flatten() {
        let path = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if !path.is_dir() || !crate::is_safe_project_id(&name) {
            continue;
        }
        let Some(created) = created_ms(&path) else {
            continue;
        };
        if now.saturating_sub(created) > limit && fs::remove_dir_all(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn briefing_session_create(app: tauri::AppHandle, project_id: String) -> Result<(), String> {
    create_in(&app_data(&app)?, &project_id, now_ms())
}

#[tauri::command]
pub fn briefing_session_list(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    Ok(list_in(&app_data(&app)?))
}

#[tauri::command]
pub fn briefing_session_delete(app: tauri::AppHandle, project_id: String) -> Result<(), String> {
    delete_in(&app_data(&app)?, &project_id)
}

/// 24 時間を過ぎた一時の動画を消す（この機能を開いた時・1 時間ごと＝画面から呼ぶ）。消した数を返す。
#[tauri::command]
pub fn briefing_sessions_cleanup(app: tauri::AppHandle) -> Result<usize, String> {
    Ok(cleanup_in(&app_data(&app)?, now_ms(), SESSION_MAX_AGE))
}

/// 起動時の片づけ（`cleanup_stale_export_dirs` と並べる）。起動を妨げないよう別のスレッドで・失敗は記録だけ。
pub fn cleanup_on_startup(app: &tauri::AppHandle) {
    let Ok(base) = app_data(app) else {
        return;
    };
    tauri::async_runtime::spawn_blocking(move || {
        let n = cleanup_in(&base, now_ms(), SESSION_MAX_AGE);
        if n > 0 {
            crate::tlog!("briefing", "24 時間を過ぎた一時の動画を {n} 件消しました");
        }
    });
}

/// 名前を変えてコピーする1つ（元の動画のファイル → 一時の動画の中の新しい名前）。
#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenamedFile {
    pub from_project_id: String,
    pub from_rel_path: String,
    pub to_rel_path: String,
}

/// コピーの結果。`missing`＝元に無かったファイル（新しい名前）＝画面が知らせる（黙って飛ばさない）。
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct RenamedCopyResult {
    pub copied: usize,
    pub missing: Vec<String>,
}

/// 原本の動画から一時の動画へ、ファイルを**名前を変えて**コピーする（ADR-0061 決定5＝場面の取り込みで番号を付け替えるため）。
///
/// ⚠️ **コピー先は一時の動画だけ**＝`temporary-sessions/<dest>` が在ることを確かめる（通常の動画へは書かない）。
/// ⚠️ **原本には書き込まない**（読むだけ）。
/// ⚠️ **途中で失敗したら、自分がコピーしたファイルを消す**（半端な一時の動画を残さない）。
/// ⚠️ **同じ新しい名前へ2回は書かない**（別々のファイルが同じ名前に来たら、取り込みの作りが壊れている＝断る）。
pub fn copy_renamed_in(
    app_data: &Path,
    dest_project_id: &str,
    files: &[RenamedFile],
) -> Result<RenamedCopyResult, String> {
    if !crate::is_safe_project_id(dest_project_id) {
        return Err(crate::messages::PROJECT_UNUSABLE.to_string());
    }
    let dest_dir = app_data.join(SESSIONS_DIR_NAME).join(dest_project_id);
    if !dest_dir.is_dir() {
        return Err(crate::messages::PROJECT_UNUSABLE.to_string());
    }
    let mut seen = std::collections::HashSet::new();
    for f in files {
        if !crate::is_safe_project_id(&f.from_project_id)
            || !crate::assets::is_safe_rel_path(&f.from_rel_path)
            || !crate::assets::is_safe_rel_path(&f.to_rel_path)
            || !seen.insert(f.to_rel_path.clone())
        {
            return Err(crate::messages::BRIEFING_SESSION_COPY_FAILED.to_string());
        }
    }
    let mut copied: Vec<PathBuf> = Vec::new();
    let mut missing = Vec::new();
    for f in files {
        let src = resolve_project_dir(app_data, &f.from_project_id).join(&f.from_rel_path);
        if !src.is_file() {
            missing.push(f.to_rel_path.clone());
            continue;
        }
        let dest = dest_dir.join(&f.to_rel_path);
        let ok = dest
            .parent()
            .map(|p| fs::create_dir_all(p).is_ok())
            .unwrap_or(false)
            && fs::copy(&src, &dest).is_ok();
        if !ok {
            for p in &copied {
                let _ = fs::remove_file(p);
            }
            return Err(crate::messages::BRIEFING_SESSION_COPY_FAILED.to_string());
        }
        copied.push(dest);
    }
    Ok(RenamedCopyResult {
        copied: copied.len(),
        missing,
    })
}

#[tauri::command]
pub fn briefing_session_copy_files(
    app: tauri::AppHandle,
    dest_project_id: String,
    files: Vec<RenamedFile>,
) -> Result<RenamedCopyResult, String> {
    copy_renamed_in(&app_data(&app)?, &dest_project_id, &files)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "stario_temp_sessions_{}_{}",
            std::process::id(),
            now_ms() ^ (rand_suffix() as u64)
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn rand_suffix() -> u32 {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        N.fetch_add(1, Ordering::SeqCst)
    }

    const ID: &str = "proj_20261105_9001";

    #[test]
    fn 通常の動画が先_無ければ一時の動画_どちらも無ければ通常() {
        let base = tmp();
        assert_eq!(
            resolve_project_dir(&base, ID),
            base.join("projects").join(ID)
        );
        create_in(&base, ID, 1).unwrap();
        assert_eq!(
            resolve_project_dir(&base, ID),
            base.join(SESSIONS_DIR_NAME).join(ID)
        );
        fs::create_dir_all(base.join("projects").join(ID)).unwrap();
        assert_eq!(
            resolve_project_dir(&base, ID),
            base.join("projects").join(ID)
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn 同じ番号が在れば作らない_危ない番号は断る() {
        let base = tmp();
        create_in(&base, ID, 1).unwrap();
        assert!(create_in(&base, ID, 1).is_err());
        fs::create_dir_all(base.join("projects").join("proj_20261105_9002")).unwrap();
        assert!(create_in(&base, "proj_20261105_9002", 1).is_err());
        assert!(!base
            .join(SESSIONS_DIR_NAME)
            .join("proj_20261105_9002")
            .exists());
        assert!(create_in(&base, "../x", 1).is_err());
        assert_eq!(list_in(&base), vec![ID.to_string()]);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn 消すのは一時の置き場所の中だけ() {
        let base = tmp();
        create_in(&base, ID, 1).unwrap();
        let normal = base.join("projects").join("proj_20261105_001");
        fs::create_dir_all(&normal).unwrap();
        delete_in(&base, ID).unwrap();
        assert!(!base.join(SESSIONS_DIR_NAME).join(ID).exists());
        // 通常の動画の番号を渡しても、通常の動画は消えない
        delete_in(&base, "proj_20261105_001").unwrap();
        assert!(normal.exists());
        assert!(delete_in(&base, "..").is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn 二十四時間を過ぎたものだけ消す_札の無い番号でない物は触らない() {
        let base = tmp();
        let day = SESSION_MAX_AGE.as_millis() as u64;
        let now = 10 * day;
        create_in(&base, "proj_20261105_9001", now - day - 1).unwrap(); // 過ぎた
        create_in(&base, "proj_20261105_9002", now - day).unwrap(); // ちょうど＝残す
        create_in(&base, "proj_20261105_9003", now - 1).unwrap(); // 新しい

        // 番号の形でない入れ物は、札が古くても触らない
        let other = base.join(SESSIONS_DIR_NAME).join("not-a-session");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join(MARKER_FILE), r#"{"createdAtMs":0}"#).unwrap();
        let file = base.join(SESSIONS_DIR_NAME).join("proj_20261105_9009");
        fs::write(&file, "x").unwrap();
        let normal = base.join("projects").join("proj_20261105_9001");
        fs::create_dir_all(&normal).unwrap();
        assert_eq!(cleanup_in(&base, now, SESSION_MAX_AGE), 1);
        assert_eq!(
            list_in(&base),
            vec![
                "proj_20261105_9002".to_string(),
                "proj_20261105_9003".to_string()
            ]
        );
        assert!(other.exists());
        assert!(file.exists());
        assert!(normal.exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn 札が読めなければフォルダの時刻で見る() {
        let base = tmp();
        create_in(&base, ID, 0).unwrap();
        fs::write(
            base.join(SESSIONS_DIR_NAME).join(ID).join(MARKER_FILE),
            "壊れた",
        )
        .unwrap();
        // フォルダの時刻＝いま＝過ぎていない
        assert_eq!(cleanup_in(&base, now_ms(), SESSION_MAX_AGE), 0);
        assert!(base.join(SESSIONS_DIR_NAME).join(ID).exists());
        let _ = fs::remove_dir_all(&base);
    }

    fn rf(from: &str, rel: &str, to: &str) -> RenamedFile {
        RenamedFile {
            from_project_id: from.to_string(),
            from_rel_path: rel.to_string(),
            to_rel_path: to.to_string(),
        }
    }

    #[test]
    fn 名前を変えてコピーする_無いファイルは知らせる_原本は変えない() {
        let base = tmp();
        let src = base.join("projects").join("proj_20261101_001");
        fs::create_dir_all(src.join("assets")).unwrap();
        fs::write(src.join("assets").join("asset_001.png"), "png").unwrap();
        create_in(&base, ID, 1).unwrap();
        let r = copy_renamed_in(
            &base,
            ID,
            &[
                rf(
                    "proj_20261101_001",
                    "assets/asset_001.png",
                    "assets/asset_007.png",
                ),
                rf(
                    "proj_20261101_001",
                    "voices/scene_001.wav",
                    "voices/scene_004.wav",
                ),
            ],
        )
        .unwrap();
        assert_eq!(
            r,
            RenamedCopyResult {
                copied: 1,
                missing: vec!["voices/scene_004.wav".to_string()]
            }
        );
        let dest = base.join(SESSIONS_DIR_NAME).join(ID);
        assert_eq!(
            fs::read_to_string(dest.join("assets").join("asset_007.png")).unwrap(),
            "png"
        );
        assert!(src.join("assets").join("asset_001.png").exists());
        assert!(!src.join("assets").join("asset_007.png").exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn コピー先は一時の動画だけ_危ない道と同じ行き先は断る() {
        let base = tmp();
        let normal = base.join("projects").join("proj_20261101_002");
        fs::create_dir_all(&normal).unwrap();
        let ok = rf("proj_20261101_002", "a.png", "assets/a.png");
        // 通常の動画へは書かない
        assert!(copy_renamed_in(&base, "proj_20261101_002", std::slice::from_ref(&ok)).is_err());
        create_in(&base, ID, 1).unwrap();
        for bad in [
            rf("..", "a.png", "assets/a.png"),
            rf("proj_20261101_002", "../x", "assets/a.png"),
            rf("proj_20261101_002", "a.png", "../../escape.png"),
            rf("proj_20261101_002", "a.png", "C:evil.png"),
        ] {
            assert!(copy_renamed_in(&base, ID, &[bad]).is_err());
        }
        assert!(copy_renamed_in(&base, ID, &[ok.clone(), ok]).is_err());
        let _ = fs::remove_dir_all(&base);
    }
}
