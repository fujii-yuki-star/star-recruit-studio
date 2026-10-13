// 拡張パック（ADR-0060）＝`.starpack`（zip）を照合して `appData/packs/<packId>/` へ置く・一覧・外す・中のファイルを読む。
//
// ⚠️ **パックはデータだけ**＝ここは展開と照合だけで、中身を実行しない。manifest の形と中身の約束は TS
//   （`src/domain/pack/extensionPack.ts`）が schema で確かめてから `pack_install` を呼ぶ。ここでは
//   **照合できること**（中のファイルの一覧と SHA-256・パスが外へ出ないこと）を、TS を信用せずにもう一度見る。
// ⚠️ **途中で失敗したら何も残さない**＝作業用のフォルダに全部展開・照合してから、最後に名前を変えて置く。
use std::collections::BTreeSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::messages;

/// manifest のファイル名（パックの一番上）。
const MANIFEST: &str = "manifest.json";
/// 中のファイルの数の上限（壊れた・悪意のある zip で止まらないため）。
const MAX_ENTRIES: usize = 5000;
/// 中のファイルの合計の上限（展開後）。声のモデルが入る段階3を見込んで広めに取る。
const MAX_TOTAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;
/// manifest の大きさの上限。
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
/// 文字として読むファイル（見た目パターン）の上限。
const MAX_TEXT_BYTES: u64 = 4 * 1024 * 1024;
/// 絵として読むファイル（既定素材）の上限。
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
/// 作業用・置き換え前のフォルダの頭（一覧に出さない・起動時に片づける）。
const STAGING_PREFIX: &str = ".staging-";
const OLD_PREFIX: &str = ".old-";
/// 外したパック（名前を変えてから消す・消し残しは起動時に片づける）。
const TRASH_PREFIX: &str = ".trash-";

/// `.old-<packId>-<時刻>` から packId を取り出す（形が違えば None）。
fn old_dir_pack_id(name: &str) -> Option<String> {
    let rest = name.strip_prefix(OLD_PREFIX)?;
    let (id, tag) = rest.rsplit_once('-')?;
    (is_safe_pack_id(id) && !tag.is_empty() && tag.chars().all(|c| c.is_ascii_digit()))
        .then(|| id.to_string())
}

fn packs_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|_| messages::PACK_INSTALL_FAILED.to_string())?;
    Ok(base.join("packs"))
}

/// packId がフォルダ名として安全か（schema と同じ形＝英小文字・数字・_・40字まで）。
pub(crate) fn is_safe_pack_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 40
        && id.starts_with(|c: char| c.is_ascii_lowercase())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        && !id.contains("__")
        // ⚠️ 末尾の `_` も断る（schema と同じ）＝`pack_ab___x` の境目が割れる（`ab` と取り違える）。
        && !id.ends_with('_')
}

/// パックの中の相対パスが安全か（`/` 区切り・各部分は英数字と `- _ .`・`.` と `..` は使わない・先頭の `/` も無し）。
/// ⚠️ **zip の名前を信用しない**＝`..\\` や `C:` や絶対パスで外へ書かせない。schema の `PackPath` と同じ規則。
pub(crate) fn is_safe_rel_path(p: &str) -> bool {
    if p.is_empty() || p.len() > 200 || p.starts_with('/') || p.ends_with('/') {
        return false;
    }
    p.split('/').all(|part| {
        // ⚠️ **Windows だけの重なりも断る**（schema より厳しい・PR レビュー ℹ️）＝末尾の `.`（`a.` は `a` と同じファイル）・
        //   予約名（`con`・`nul`・`aux.json` など＝書き込みが装置へ流れる）。大文字小文字違いの重なりは `entry_names` が断る。
        !part.is_empty()
            && part != "."
            && part != ".."
            && !part.ends_with('.')
            && !is_windows_reserved(part)
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    })
}

/// Windows の予約名か（拡張子を付けても予約のまま＝`nul.json` も装置になる）。
fn is_windows_reserved(part: &str) -> bool {
    let stem = part.split('.').next().unwrap_or("").to_ascii_lowercase();
    matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || ((stem.starts_with("com") || stem.starts_with("lpt"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// manifest の `files`（相対パス → SHA-256）と packId を読む。形の検証は TS 済み＝ここは使う欄だけ。
fn manifest_files(manifest: &str) -> Result<(String, Vec<(String, String)>), String> {
    let v: serde_json::Value =
        serde_json::from_str(manifest).map_err(|_| messages::PACK_UNREADABLE.to_string())?;
    let pack_id = v
        .get("packId")
        .and_then(|x| x.as_str())
        .ok_or_else(|| messages::PACK_UNREADABLE.to_string())?;
    let files = v
        .get("files")
        .and_then(|x| x.as_array())
        .ok_or_else(|| messages::PACK_UNREADABLE.to_string())?;
    let mut out = Vec::new();
    for f in files {
        let path = f
            .get("path")
            .and_then(|x| x.as_str())
            .ok_or_else(|| messages::PACK_UNREADABLE.to_string())?;
        let sha = f
            .get("sha256")
            .and_then(|x| x.as_str())
            .ok_or_else(|| messages::PACK_UNREADABLE.to_string())?;
        if !is_safe_rel_path(path) || path == MANIFEST || sha.len() != 64 {
            return Err(messages::PACK_UNREADABLE.to_string());
        }
        out.push((path.to_string(), sha.to_ascii_lowercase()));
    }
    Ok((pack_id.to_string(), out))
}

fn open_archive(path: &str) -> Result<zip::ZipArchive<fs::File>, String> {
    let f = fs::File::open(path).map_err(|_| messages::PACK_UNREADABLE.to_string())?;
    let zip = zip::ZipArchive::new(f).map_err(|_| messages::PACK_UNREADABLE.to_string())?;
    if zip.len() > MAX_ENTRIES {
        return Err(messages::PACK_TOO_LARGE.to_string());
    }
    Ok(zip)
}

/// zip の中のファイル名の一覧（フォルダは除く）。危ない名前が1つでもあれば断る。
fn entry_names(zip: &mut zip::ZipArchive<fs::File>) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    // ⚠️ 大文字小文字だけ違う名前の重なりを断る（Windows では同じファイル＝照合した中身と書いた中身がずれる）。
    let mut seen_lower = BTreeSet::new();
    let mut total: u64 = 0;
    for i in 0..zip.len() {
        let e = zip
            .by_index(i)
            .map_err(|_| messages::PACK_UNREADABLE.to_string())?;
        if e.is_dir() {
            continue;
        }
        let name = e
            .name()
            .map_err(|_| messages::PACK_UNREADABLE.to_string())?
            .to_string();
        if !is_safe_rel_path(&name) || !seen_lower.insert(name.to_ascii_lowercase()) {
            return Err(messages::PACK_TAMPERED.to_string());
        }
        total = total.saturating_add(e.size());
        if total > MAX_TOTAL_BYTES {
            return Err(messages::PACK_TOO_LARGE.to_string());
        }
        names.push(name);
    }
    Ok(names)
}

fn read_manifest(zip: &mut zip::ZipArchive<fs::File>) -> Result<String, String> {
    let mut e = zip
        .by_name(MANIFEST)
        .map_err(|_| messages::PACK_UNREADABLE.to_string())?;
    if e.size() > MAX_MANIFEST_BYTES {
        return Err(messages::PACK_UNREADABLE.to_string());
    }
    let mut s = String::new();
    // ⚠️ 書いてある大きさを信用せず、上限＋1 までしか読まない（超えたら断る）。
    (&mut e)
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_string(&mut s)
        .map_err(|_| messages::PACK_UNREADABLE.to_string())?;
    if s.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(messages::PACK_UNREADABLE.to_string());
    }
    Ok(s)
}

/// 重い処理（展開・照合・読み込み）を窓の外で走らせる（PR レビュー 🟡）＝同期のコマンドは窓の糸で走り、
/// 大きなパックの展開と照合の間、窓が「応答なし」になる（このリポジトリの流儀＝`spawn_blocking`）。
async fn run_blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| messages::PACK_INSTALL_FAILED.to_string())?
}

fn inspect_blocking(path: &str) -> Result<String, String> {
    let mut zip = open_archive(path)?;
    entry_names(&mut zip)?;
    read_manifest(&mut zip)
}

/// 入れる前に中身を見る＝manifest の文字だけを返す（展開しない）。画面は形を確かめてから中身・発行者・権利を見せる。
#[tauri::command]
pub async fn pack_inspect(path: String) -> Result<String, String> {
    run_blocking(move || inspect_blocking(&path)).await
}

/// 中のファイル一覧が manifest の `files` とちょうど一致するか（多い・足りないのどちらも断る）。
fn same_file_set(entries: &[String], listed: &[(String, String)]) -> bool {
    let a: BTreeSet<&str> = entries
        .iter()
        .map(String::as_str)
        .filter(|n| *n != MANIFEST)
        .collect();
    let b: BTreeSet<&str> = listed.iter().map(|(p, _)| p.as_str()).collect();
    a == b && b.len() == listed.len()
}

/// 1つ展開しながら SHA-256 を取り、合わなければ断る。
/// ⚠️ **書いた量も数える**＝zip に**書いてある大きさ**（`size()`）は信用しない（嘘の大きさで展開を膨らませる zip がある）。
///   書いてある大きさを超えた・残りの上限（`budget`）を超えたら、その場で止めて断る。
fn extract_checked(
    zip: &mut zip::ZipArchive<fs::File>,
    name: &str,
    sha: &str,
    dest: &Path,
    budget: &mut u64,
) -> Result<(), String> {
    let mut e = zip
        .by_name(name)
        .map_err(|_| messages::PACK_TAMPERED.to_string())?;
    let declared = e.size();
    let mut written: u64 = 0;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|_| messages::PACK_INSTALL_FAILED.to_string())?;
    }
    let mut out = fs::File::create(dest).map_err(|_| messages::PACK_INSTALL_FAILED.to_string())?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = e
            .read(&mut buf)
            .map_err(|_| messages::PACK_TAMPERED.to_string())?;
        if n == 0 {
            break;
        }
        written += n as u64;
        if written > declared || written > *budget {
            return Err(messages::PACK_TOO_LARGE.to_string());
        }
        h.update(&buf[..n]);
        out.write_all(&buf[..n])
            .map_err(|_| messages::PACK_INSTALL_FAILED.to_string())?;
    }
    *budget -= written;
    if hex(&h.finalize()) != sha {
        return Err(messages::PACK_TAMPERED.to_string());
    }
    Ok(())
}

fn now_tag() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// 照合して入れる。`shown_manifest` は**画面が見せた manifest の文字そのもの**＝見せてから入れるまでの間に
/// ファイルが差し替わっていたら断る（PR レビュー 🟡＝見せた発行者・権利・版と違うものを入れない）。
/// 同じ packId が入っていれば置き換える（古い版を断るのは画面＝版の比べ方は TS）。
#[tauri::command]
pub async fn pack_install(
    app: tauri::AppHandle,
    path: String,
    pack_id: String,
    shown_manifest: String,
) -> Result<(), String> {
    run_blocking(move || install_blocking(&app, &path, &pack_id, &shown_manifest)).await
}

fn install_blocking(
    app: &tauri::AppHandle,
    path: &str,
    pack_id: &str,
    shown_manifest: &str,
) -> Result<(), String> {
    if !is_safe_pack_id(pack_id) {
        return Err(messages::PACK_UNREADABLE.to_string());
    }
    let mut zip = open_archive(path)?;
    let entries = entry_names(&mut zip)?;
    let manifest = read_manifest(&mut zip)?;
    if manifest != shown_manifest {
        return Err(messages::PACK_TAMPERED.to_string());
    }
    let (id_in_zip, files) = manifest_files(&manifest)?;
    if id_in_zip != pack_id {
        return Err(messages::PACK_TAMPERED.to_string());
    }
    if !same_file_set(&entries, &files) {
        return Err(messages::PACK_TAMPERED.to_string());
    }
    let root = packs_dir(app)?;
    fs::create_dir_all(&root).map_err(|_| messages::PACK_INSTALL_FAILED.to_string())?;
    let staging = root.join(format!("{STAGING_PREFIX}{pack_id}-{}", now_tag()));
    let mut budget = MAX_TOTAL_BYTES;
    let result = (|| {
        fs::create_dir_all(&staging).map_err(|_| messages::PACK_INSTALL_FAILED.to_string())?;
        for (rel, sha) in &files {
            extract_checked(&mut zip, rel, sha, &staging.join(rel), &mut budget)?;
        }
        fs::write(staging.join(MANIFEST), &manifest)
            .map_err(|_| messages::PACK_INSTALL_FAILED.to_string())?;
        let target = root.join(pack_id);
        if target.exists() {
            let old = root.join(format!("{OLD_PREFIX}{pack_id}-{}", now_tag()));
            fs::rename(&target, &old).map_err(|_| messages::PACK_INSTALL_FAILED.to_string())?;
            if fs::rename(&staging, &target).is_err() {
                // 置き換えに失敗したら、元を戻す（入っていたパックを失わない）。
                let _ = fs::rename(&old, &target);
                return Err(messages::PACK_INSTALL_FAILED.to_string());
            }
            let _ = fs::remove_dir_all(&old);
        } else {
            fs::rename(&staging, &target).map_err(|_| messages::PACK_INSTALL_FAILED.to_string())?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// 入っているパックの manifest（文字）を並べる。読めないフォルダ・作業用のフォルダは飛ばす。
#[tauri::command]
pub fn pack_list(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let root = packs_dir(&app)?;
    let Ok(rd) = fs::read_dir(&root) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !is_safe_pack_id(&name) || !e.path().is_dir() {
            continue;
        }
        if let Ok(s) = fs::read_to_string(e.path().join(MANIFEST)) {
            out.push(s);
        }
    }
    out.sort();
    Ok(out)
}

/// 外す（フォルダごと消す）。使っている動画を知らせるのは画面（外す前）。
/// ⚠️ **先に名前を変えてから消す**（PR レビュー ℹ️）＝消す途中で止まると、半端なフォルダが「読めないパック」として残る。
///   名前を変えた時点で一覧からは消え、消し残しは次の起動の片づけが消す。
#[tauri::command]
pub fn pack_uninstall(app: tauri::AppHandle, pack_id: String) -> Result<(), String> {
    if !is_safe_pack_id(&pack_id) {
        return Err(messages::PACK_REMOVE_FAILED.to_string());
    }
    let root = packs_dir(&app)?;
    let dir = root.join(&pack_id);
    if !dir.exists() {
        return Ok(());
    }
    let trash = root.join(format!("{TRASH_PREFIX}{pack_id}-{}", now_tag()));
    fs::rename(&dir, &trash).map_err(|_| messages::PACK_REMOVE_FAILED.to_string())?;
    let _ = fs::remove_dir_all(&trash);
    Ok(())
}

fn pack_file(app: &tauri::AppHandle, pack_id: &str, rel: &str) -> Result<PathBuf, String> {
    if !is_safe_pack_id(pack_id) || !is_safe_rel_path(rel) {
        return Err(messages::PACK_UNREADABLE.to_string());
    }
    Ok(packs_dir(app)?.join(pack_id).join(rel))
}

/// 中の文字のファイル（見た目パターンの JSON）を読む。
#[tauri::command]
pub async fn pack_read_text(
    app: tauri::AppHandle,
    pack_id: String,
    rel: String,
) -> Result<String, String> {
    run_blocking(move || read_text_blocking(&app, &pack_id, &rel)).await
}

fn read_text_blocking(app: &tauri::AppHandle, pack_id: &str, rel: &str) -> Result<String, String> {
    let p = pack_file(app, pack_id, rel)?;
    let len = fs::metadata(&p)
        .map_err(|_| messages::PACK_UNREADABLE.to_string())?
        .len();
    if len > MAX_TEXT_BYTES {
        return Err(messages::PACK_UNREADABLE.to_string());
    }
    fs::read_to_string(&p).map_err(|_| messages::PACK_UNREADABLE.to_string())
}

/// 中の絵（既定素材）を data URL で読む（今の見た目パターンの既定素材と同じ渡し方）。
#[tauri::command]
pub async fn pack_read_data_url(
    app: tauri::AppHandle,
    pack_id: String,
    rel: String,
) -> Result<String, String> {
    run_blocking(move || read_data_url_blocking(&app, &pack_id, &rel)).await
}

fn read_data_url_blocking(
    app: &tauri::AppHandle,
    pack_id: &str,
    rel: &str,
) -> Result<String, String> {
    use base64::Engine;
    let p = pack_file(app, pack_id, rel)?;
    let mime = match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => return Err(messages::PACK_UNREADABLE.to_string()),
    };
    let len = fs::metadata(&p)
        .map_err(|_| messages::PACK_UNREADABLE.to_string())?
        .len();
    if len > MAX_IMAGE_BYTES {
        return Err(messages::PACK_UNREADABLE.to_string());
    }
    let bytes = fs::read(&p).map_err(|_| messages::PACK_UNREADABLE.to_string())?;
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// 起動時の片づけ＝途中で止まった作業用・外したフォルダを消す（入っているパックには触らない）。
/// ⚠️ **置き換え前のフォルダ（`.old-`）は、置き換えが済んでいれば消し、済んでいなければ戻す**（PR レビュー ℹ️）＝
///   置き換えの途中で両方の名前の変更が失敗すると元のパックは `.old-` にしか無い。黙って消すと**入っていたパックが無言で失われる**。
pub fn cleanup_pack_staging(app: &tauri::AppHandle) {
    let Ok(root) = packs_dir(app) else { return };
    let Ok(rd) = fs::read_dir(&root) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !e.path().is_dir() {
            continue;
        }
        if name.starts_with(STAGING_PREFIX) || name.starts_with(TRASH_PREFIX) {
            let _ = fs::remove_dir_all(e.path());
        } else if let Some(id) = old_dir_pack_id(&name) {
            let target = root.join(&id);
            if target.exists() {
                let _ = fs::remove_dir_all(e.path());
            } else {
                let _ = fs::rename(e.path(), &target);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_rel_path_rejects_escapes() {
        assert!(is_safe_rel_path("templates/intro.json"));
        assert!(is_safe_rel_path("assets/logo-01.png"));
        for bad in [
            "",
            "/abs.json",
            "../x",
            "a/../b",
            "a/./b",
            "a//b",
            "a\\b",
            "C:/x",
            "a/",
            "a b.json",
            "テンプレ.json",
            "a.",
            "t/logo.png.",
            "nul",
            "con.json",
            "t/Aux.png",
            "com1.txt",
            "lpt9",
        ] {
            assert!(!is_safe_rel_path(bad), "{bad}");
        }
    }

    #[test]
    fn safe_pack_id_matches_schema() {
        assert!(is_safe_pack_id("office_looks"));
        assert!(is_safe_pack_id("a1"));
        for bad in [
            "",
            "1abc",
            "Office",
            "a-b",
            "a__b",
            "a.b",
            "../x",
            "ab_",
            &"a".repeat(41),
        ] {
            assert!(!is_safe_pack_id(bad), "{bad}");
        }
        // 予約名でない似た名前は通す（過剰に断らない）。
        assert!(is_safe_rel_path("t/console.json"));
        assert!(is_safe_rel_path("t/com10.png"));
        assert!(is_safe_rel_path(".hidden"));
    }

    #[test]
    fn old_dir_name_round_trips_pack_id() {
        assert_eq!(
            old_dir_pack_id(".old-office_looks-1700000000000").as_deref(),
            Some("office_looks")
        );
        assert_eq!(
            old_dir_pack_id(".old-office-looks-12"),
            None,
            "packId に - は無い"
        );
        assert_eq!(old_dir_pack_id(".old-office_looks-"), None);
        assert_eq!(old_dir_pack_id(".staging-office_looks-12"), None);
    }

    #[test]
    fn file_set_must_match_exactly() {
        let listed = vec![
            ("a.json".to_string(), "x".repeat(64)),
            ("b.png".to_string(), "y".repeat(64)),
        ];
        let entries = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(same_file_set(
            &entries(&["manifest.json", "a.json", "b.png"]),
            &listed
        ));
        assert!(
            !same_file_set(&entries(&["manifest.json", "a.json"]), &listed),
            "足りない"
        );
        assert!(
            !same_file_set(
                &entries(&["manifest.json", "a.json", "b.png", "evil.dll"]),
                &listed
            ),
            "多い"
        );
        let dup = vec![listed[0].clone(), listed[0].clone()];
        assert!(!same_file_set(&entries(&["a.json"]), &dup), "一覧の重なり");
    }

    #[test]
    fn manifest_files_rejects_unsafe_and_manifest_itself() {
        let ok = r#"{"packId":"p","files":[{"path":"t/a.json","sha256":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}]}"#;
        let (id, f) = manifest_files(ok).unwrap();
        assert_eq!(id, "p");
        assert_eq!(f[0].1, "a".repeat(64), "小文字にそろえる");
        let esc = r#"{"packId":"p","files":[{"path":"../a.json","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}"#;
        assert!(manifest_files(esc).is_err());
        let mf = r#"{"packId":"p","files":[{"path":"manifest.json","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}"#;
        assert!(manifest_files(mf).is_err());
    }

    /// 本物の zip を作って、照合しながら展開する（合う・中身を書き換えた・名前で外へ出る）。
    #[test]
    fn extract_checked_detects_tampering() {
        use zip::write::SimpleFileOptions;
        let dir = std::env::temp_dir().join(format!("stario_pack_test_{}", now_tag()));
        fs::create_dir_all(&dir).unwrap();
        let zpath = dir.join("t.starpack");
        {
            let mut w = zip::ZipWriter::new(fs::File::create(&zpath).unwrap());
            w.start_file("t/a.json", SimpleFileOptions::default())
                .unwrap();
            w.write_all(b"hello").unwrap();
            w.finish().unwrap();
        }
        let good = hex(&Sha256::digest(b"hello"));
        let mut zip = zip::ZipArchive::new(fs::File::open(&zpath).unwrap()).unwrap();
        let (mut big, mut big2) = (u64::MAX, u64::MAX);
        assert!(extract_checked(
            &mut zip,
            "t/a.json",
            &good,
            &dir.join("out/t/a.json"),
            &mut big
        )
        .is_ok());
        assert_eq!(
            fs::read_to_string(dir.join("out/t/a.json")).unwrap(),
            "hello"
        );
        let bad = hex(&Sha256::digest(b"other"));
        assert_eq!(
            extract_checked(
                &mut zip,
                "t/a.json",
                &bad,
                &dir.join("out2/a.json"),
                &mut big2
            )
            .unwrap_err(),
            messages::PACK_TAMPERED
        );
        // 残りの上限を超えたら、その場で止める（書いてある大きさを信用しない）。
        let mut small: u64 = 3;
        assert_eq!(
            extract_checked(
                &mut zip,
                "t/a.json",
                &good,
                &dir.join("out3/a.json"),
                &mut small
            )
            .unwrap_err(),
            messages::PACK_TOO_LARGE
        );
        // 通ったら、書いた量を残りから引く。
        let mut rest: u64 = 10;
        extract_checked(
            &mut zip,
            "t/a.json",
            &good,
            &dir.join("out4/a.json"),
            &mut rest,
        )
        .unwrap();
        assert_eq!(rest, 5);
        let _ = fs::remove_dir_all(&dir);
    }
}
