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
/// 文字の形の上限（日本語の字体は 10〜20MB ほどあるので、絵より広く取る）。
const MAX_FONT_BYTES: u64 = 64 * 1024 * 1024;
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
/// 1ファイルの大きさの上限＝**読むときの上限と同じ**（PR レビュー 🟡）。
/// ⚠️ 入れるときに見ないと、入ったのに読めない中身ができる（字なら一覧に載って門を通り、描画は既定へ倒れる＝黙って別の字）。
fn file_cap(p: &Path) -> u64 {
    if p.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("json"))
        == Some(true)
    {
        return MAX_TEXT_BYTES;
    }
    data_url_kind(p).map(|(_, max)| max).unwrap_or(u64::MAX)
}

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
    let cap = file_cap(Path::new(name));
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
        if written > declared || written > *budget || written > cap {
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

/// パックの中の声の名前（`voiceId`）として安全か（schema と同じ＝英小文字・数字・単独の `_`）。
fn is_safe_voice_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 40
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        && !id.starts_with('_')
        && !id.ends_with('_')
        && !id.contains("__")
}

/// manifest に書かれた声1つぶん（段階3）。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeclaredVoice {
    pub pack_id: String,
    pub voice_id: String,
    pub path: PathBuf,
    pub character: String,
    pub speakers: Vec<i64>,
}

/// manifest の文字から、声（`contents.voices[].{voiceId,file,character,styles[].speaker}`）を取り出す（段階3）。
/// ⚠️ **形の悪い項目は黙って飛ばさず、その manifest の声を全部捨てる**＝半分だけ読むと、画面の声の一覧と音声ソフトが読む声が食い違う。
fn manifest_voices(manifest: &str) -> Vec<(String, String, String, Vec<i64>)> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(manifest) else {
        return Vec::new();
    };
    let Some(items) = v
        .get("contents")
        .and_then(|c| c.get("voices"))
        .and_then(|x| x.as_array())
    else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for it in items {
        let (Some(id), Some(file), Some(character), Some(styles)) = (
            it.get("voiceId").and_then(|x| x.as_str()),
            it.get("file").and_then(|x| x.as_str()),
            it.get("character").and_then(|x| x.as_str()),
            it.get("styles").and_then(|x| x.as_array()),
        ) else {
            return Vec::new();
        };
        if !is_safe_voice_id(id)
            || !is_safe_rel_path(file)
            || !file.ends_with(".vvm")
            || character.is_empty()
        {
            return Vec::new();
        }
        let speakers: Vec<i64> = styles
            .iter()
            .filter_map(|s| s.get("speaker").and_then(|x| x.as_i64()))
            .collect();
        if speakers.is_empty() || speakers.len() != styles.len() {
            return Vec::new();
        }
        out.push((
            id.to_string(),
            file.to_string(),
            character.to_string(),
            speakers,
        ));
    }
    out
}

/// 入っているパックの声（段階3）。packId の順。実体が無いものは入れない。
fn installed_declared_voices(app: &tauri::AppHandle) -> Vec<DeclaredVoice> {
    let Ok(root) = packs_dir(app) else {
        return Vec::new();
    };
    let Ok(rd) = fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !is_safe_pack_id(&name) || !e.path().is_dir() {
            continue;
        }
        let Ok(m) = fs::read_to_string(e.path().join(MANIFEST)) else {
            continue;
        };
        for (voice_id, file, character, speakers) in manifest_voices(&m) {
            let path = e.path().join(&file);
            if path.is_file() {
                out.push(DeclaredVoice {
                    pack_id: name.clone(),
                    voice_id,
                    path,
                    character,
                    speakers,
                });
            }
        }
    }
    out.sort_by(|a, b| (&a.pack_id, &a.voice_id).cmp(&(&b.pack_id, &b.voice_id)));
    out
}

/// 声のファイル（`.vvm`＝zip）の中の `metas.json` から、キャラ名とスタイル番号を読む。読めなければ None。
pub(crate) fn vvm_styles(path: &Path) -> Option<Vec<(String, Vec<i64>)>> {
    let f = fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(f).ok()?;
    let mut e = zip.by_name("metas.json").ok()?;
    if e.size() > MAX_MANIFEST_BYTES {
        return None;
    }
    let mut text = String::new();
    e.read_to_string(&mut text).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let mut out = Vec::new();
    for c in v.as_array()? {
        let name = c.get("name")?.as_str()?.to_string();
        let ids = c
            .get("styles")?
            .as_array()?
            .iter()
            .map(|s| s.get("id").and_then(|x| x.as_i64()))
            .collect::<Option<Vec<i64>>>()?;
        out.push((name, ids));
    }
    Some(out)
}

/// 会社の動画で使えるキャラ（クレジットで商用可・申請不要）＝声のファイルの中身は**全員**この中でなければ読ませない。
/// ⚠️ **画面側の `COMPANY_OK_VOICE_CHARACTERS`（`src/domain/voice/voiceCatalog.ts`）と同じ一覧**＝門番（`src/test/voiceAllowlistParity.test.ts`）が突き合わせる。
///   根拠は `13 §4`（2026-10-16 に全キャラの規約ページを確かめた・利用者の判断＝確かめが要る危ない橋は渡らない）。
pub(crate) const COMPANY_OK_VOICE_CHARACTERS: &[&str] = &[
    "ずんだもん",
    "四国めたん",
    "九州そら",
    "春日部つむぎ",
    "雨晴はう",
    "波音リツ",
    "玄野武宏",
    "白上虎太郎",
    "冥鳴ひまり",
    "剣崎雌雄",
    "ちび式じい",
    "東北ずん子",
    "東北きりたん",
    "東北イタコ",
    "中国うさぎ",
    "中部つるぎ",
    "あんこもん",
    "雀松朱司",
    "麒ヶ島宗麟",
    "黒沢冴白",
    "櫻歌ミコ",
    "小夜/SAYO",
    "†聖騎士 紅桜†",
    "春歌ナナ",
    "あいえるたん",
    "満別花丸",
    "離途",
];

/// どの声を音声ソフトに読ませるか（段階3）＝**判定はここ1か所**（画面はこの結果だけを声の一覧とクレジットに足す）。
/// 声のファイルごとに見る（1つのファイルに複数のキャラが入っていることがある＝例：紅桜・雀松朱司・麒ヶ島宗麟）。
/// ファイルを採る条件：①中身が読める ②中身の番号がファイルの中で重ならない ③中身の**全部の番号**が、同梱の声とも、
/// 先に採ったファイルの番号とも重ならない（packId・voiceId の順に先勝ち）。
/// 採ったファイルの中で、書かれた声を採る条件：④キャラ名が中身に在り、書かれた番号がそのキャラの番号に全部入っている
/// ⑤会社の動画で使えるキャラ（`COMPANY_OK_VOICE_CHARACTERS`）。
/// ⚠️ ④を見ないと、クレジットの名前（manifest）と実際に鳴る声（中身）が別物になりうる（ADR-0003）。
/// ⚠️ ③を見ないと、音声ソフトに同じ番号が2つ並び、どちらで読むかが決まらない（実際に起動して確かめた＝落ちずに並ぶ）。
/// ⚠️ **書かれていないキャラ・使えないキャラは、同じファイルに入っていても出さないだけ**（2026-10-16 利用者の判断）＝
///   画面の一覧（と動画の声の解決）は採った声だけを知るので、選べず、声の番号が直に書かれていても既定の声へ倒れる（同梱の声と同じ形）。
///   ファイルごと断ると、同じファイルの使えるキャラまで使えなくなる。
pub(crate) fn plan_voices<F>(
    bundled_ids: &BTreeSet<i64>,
    declared: Vec<DeclaredVoice>,
    read: F,
) -> (Vec<DeclaredVoice>, Vec<DeclaredVoice>)
where
    F: Fn(&Path) -> Option<Vec<(String, Vec<i64>)>>,
{
    let mut taken = bundled_ids.clone();
    let (mut accepted, mut rejected) = (Vec::new(), Vec::new());
    // 同じファイルを指す声をまとめる（最初に出てきた順）。
    let mut files: Vec<(PathBuf, Vec<DeclaredVoice>)> = Vec::new();
    for d in declared {
        match files.iter_mut().find(|(p, _)| *p == d.path) {
            Some((_, group)) => group.push(d),
            None => files.push((d.path.clone(), vec![d])),
        }
    }
    for (path, group) in files {
        let metas = read(&path).filter(|metas| {
            let all: Vec<i64> = metas
                .iter()
                .flat_map(|(_, ids)| ids.iter().copied())
                .collect();
            all.iter().collect::<BTreeSet<_>>().len() == all.len()
                && all.iter().all(|id| !taken.contains(id))
        });
        let Some(metas) = metas else {
            rejected.extend(group);
            continue;
        };
        let mut any = false;
        for d in group {
            let named = metas.iter().find(|(n, _)| *n == d.character);
            let ok = named.is_some_and(|(_, ids)| d.speakers.iter().all(|s| ids.contains(s)))
                && COMPANY_OK_VOICE_CHARACTERS.contains(&d.character.as_str());
            if ok {
                any = true;
                accepted.push(d);
            } else {
                rejected.push(d);
            }
        }
        // 1つでも採ったら、ファイルの全部の番号を押さえる（音声ソフトはファイルごと読むので、出さない声の番号も並ぶ）。
        if any {
            taken.extend(metas.iter().flat_map(|(_, ids)| ids.iter().copied()));
        }
    }
    (accepted, rejected)
}

/// 同梱の声の番号の全部（`<engine>/model/*.vvm` の中身から）。
pub(crate) fn bundled_style_ids(engine_dir: &Path) -> BTreeSet<i64> {
    let mut out = BTreeSet::new();
    if let Ok(rd) = fs::read_dir(engine_dir.join("model")) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("vvm") {
                for (_, ids) in vvm_styles(&p).unwrap_or_default() {
                    out.extend(ids);
                }
            }
        }
    }
    out
}

/// 入っているパックの声の採否（段階3）。`engine_dir` は同梱の音声ソフトの置き場（無ければ同梱の番号は空）。
pub(crate) fn voice_plan(
    app: &tauri::AppHandle,
    engine_dir: Option<&Path>,
) -> (Vec<DeclaredVoice>, Vec<DeclaredVoice>) {
    let bundled = engine_dir.map(bundled_style_ids).unwrap_or_default();
    plan_voices(&bundled, installed_declared_voices(app), vvm_styles)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceRef {
    pack_id: String,
    voice_id: String,
}

#[derive(serde::Serialize)]
pub struct VoicePlan {
    accepted: Vec<VoiceRef>,
    rejected: Vec<VoiceRef>,
}

fn voice_refs(v: Vec<DeclaredVoice>) -> Vec<VoiceRef> {
    v.into_iter()
        .map(|d| VoiceRef {
            pack_id: d.pack_id,
            voice_id: d.voice_id,
        })
        .collect()
}

/// 画面が声の一覧に足す声（＝音声ソフトに読ませる声）と、足さない声（段階3）。
#[tauri::command]
pub async fn pack_voice_plan(app: tauri::AppHandle) -> Result<VoicePlan, String> {
    run_blocking(move || {
        let engine_dir = crate::voicevox_engine::bundled_engine_dir(&app);
        let (a, r) = voice_plan(&app, engine_dir.as_deref());
        Ok(VoicePlan {
            accepted: voice_refs(a),
            rejected: voice_refs(r),
        })
    })
    .await
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

/// 絵か文字の形として読めるファイルの種類と大きさの上限（拡張子で決める・それ以外は読まない）。
fn data_url_kind(p: &Path) -> Option<(&'static str, u64)> {
    let ext = p.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => ("image/png", MAX_IMAGE_BYTES),
        "jpg" | "jpeg" => ("image/jpeg", MAX_IMAGE_BYTES),
        "webp" => ("image/webp", MAX_IMAGE_BYTES),
        // 文字の形（段階2）＝画面が `FontFace` に渡す（持ち込みフォントと同じくバイト列で渡す・ADR-0038）。
        "ttf" => ("font/ttf", MAX_FONT_BYTES),
        "otf" => ("font/otf", MAX_FONT_BYTES),
        "woff" => ("font/woff", MAX_FONT_BYTES),
        "woff2" => ("font/woff2", MAX_FONT_BYTES),
        _ => return None,
    })
}

fn read_data_url_blocking(
    app: &tauri::AppHandle,
    pack_id: &str,
    rel: &str,
) -> Result<String, String> {
    use base64::Engine;
    let p = pack_file(app, pack_id, rel)?;
    let (mime, max) = data_url_kind(&p).ok_or_else(|| messages::PACK_UNREADABLE.to_string())?;
    let len = fs::metadata(&p)
        .map_err(|_| messages::PACK_UNREADABLE.to_string())?
        .len();
    if len > max {
        return Err(messages::PACK_UNREADABLE.to_string());
    }
    let bytes = fs::read(&p).map_err(|_| messages::PACK_UNREADABLE.to_string())?;
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// 動画へコピーしてよい音のファイルか（段階2b＝BGM）。⚠️ **domain の `AUDIO_FILE_EXTENSIONS` と同じ並び**（取り込みで受ける音・`extensionPack.test.ts` が照合）。
/// 大文字の拡張子もここでは通すが、manifest の schema が小文字だけを受けるので、パックの中に大文字は入らない（先に schema で断る）。
fn is_pack_audio(p: &Path) -> bool {
    const AUDIO: [&str; 6] = ["mp3", "m4a", "wav", "aac", "ogg", "flac"];
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// パックの音楽を動画の素材としてコピーする（段階2b・ADR-0060 決定5＝BGM は動画へコピー＝パックを外しても鳴る）。
/// ⚠️ **素材の棚からの取り込みと同じ置き場・同じ名前の決まり**（`assets/<file_name>`・名前は呼ぶ側が採番）。
#[tauri::command]
pub async fn pack_copy_to_project(
    app: tauri::AppHandle,
    pack_id: String,
    rel: String,
    project_id: String,
    file_name: String,
) -> Result<String, String> {
    run_blocking(move || {
        let src =
            pack_file(&app, &pack_id, &rel).map_err(|_| messages::PACK_COPY_FAILED.to_string())?;
        if !is_pack_audio(&src) || !src.is_file() {
            return Err(messages::PACK_COPY_FAILED.to_string());
        }
        if !crate::assets::is_safe_single_file_name(&file_name) {
            return Err(messages::PACK_COPY_FAILED.to_string());
        }
        let dir = crate::assets::project_dir(&app, &project_id)?.join("assets");
        fs::create_dir_all(&dir).map_err(|_| messages::PACK_COPY_FAILED.to_string())?;
        fs::copy(&src, dir.join(&file_name)).map_err(|_| messages::PACK_COPY_FAILED.to_string())?;
        Ok(format!("assets/{file_name}"))
    })
    .await
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
    fn extract_stops_at_the_per_file_cap() {
        use zip::write::SimpleFileOptions;
        let dir = std::env::temp_dir().join(format!("stario_pack_cap_{}", now_tag()));
        fs::create_dir_all(&dir).unwrap();
        let zpath = dir.join("t.starpack");
        let body = vec![b' '; (MAX_TEXT_BYTES + 1) as usize];
        {
            let mut w = zip::ZipWriter::new(fs::File::create(&zpath).unwrap());
            w.start_file("t/big.json", SimpleFileOptions::default())
                .unwrap();
            w.write_all(&body).unwrap();
            w.finish().unwrap();
        }
        let sha = hex(&Sha256::digest(&body));
        let mut zip = zip::ZipArchive::new(fs::File::open(&zpath).unwrap()).unwrap();
        let mut budget = u64::MAX;
        assert_eq!(
            extract_checked(
                &mut zip,
                "t/big.json",
                &sha,
                &dir.join("out/big.json"),
                &mut budget
            )
            .unwrap_err(),
            messages::PACK_TOO_LARGE
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn manifest_voices_reads_all_or_nothing() {
        let ok = r#"{"contents":{"voices":[{"voiceId":"aoi","file":"v/aoi.vvm","character":"あおい","styles":[{"speaker":9001,"label":"a"}]}]}}"#;
        assert_eq!(
            manifest_voices(ok),
            vec![(
                "aoi".to_string(),
                "v/aoi.vvm".to_string(),
                "あおい".to_string(),
                vec![9001]
            )]
        );
        assert!(manifest_voices(r#"{"contents":{"templates":[]}}"#).is_empty());
        let good = r#"{"voiceId":"aoi","file":"v/aoi.vvm","character":"あ","styles":[{"speaker":1,"label":"a"}]}"#;
        // 1つでも形が悪ければ、その manifest の声は全部捨てる（画面と音声ソフトで食い違わせない）。
        for bad in [
            r#"{"voiceId":"x","file":"../x.vvm","character":"あ","styles":[{"speaker":2,"label":"a"}]}"#,
            r#"{"voiceId":"a__b","file":"v/b.vvm","character":"あ","styles":[{"speaker":2,"label":"a"}]}"#,
            r#"{"voiceId":"b","file":"v/b.exe","character":"あ","styles":[{"speaker":2,"label":"a"}]}"#,
            r#"{"file":"v/b.vvm","character":"あ","styles":[{"speaker":2,"label":"a"}]}"#,
            r#"{"voiceId":"b","file":"v/b.vvm","styles":[{"speaker":2,"label":"a"}]}"#,
            r#"{"voiceId":"b","file":"v/b.vvm","character":"あ","styles":[{"speaker":1.5,"label":"a"}]}"#,
        ] {
            let m = format!(r#"{{"contents":{{"voices":[{good},{bad}]}}}}"#);
            assert!(manifest_voices(&m).is_empty(), "{bad}");
        }
        assert!(manifest_voices("not json").is_empty());
    }

    fn dv(pack: &str, voice: &str, character: &str, speakers: &[i64]) -> DeclaredVoice {
        dvf(pack, voice, voice, character, speakers)
    }

    /// 声のファイルを名指しする版（1つのファイルを複数の声が指すとき）。
    fn dvf(
        pack: &str,
        voice: &str,
        file: &str,
        character: &str,
        speakers: &[i64],
    ) -> DeclaredVoice {
        DeclaredVoice {
            pack_id: pack.into(),
            voice_id: voice.into(),
            path: PathBuf::from(format!("{pack}/{file}.vvm")),
            character: character.into(),
            speakers: speakers.to_vec(),
        }
    }

    #[test]
    fn plan_voices_checks_contents_and_overlaps() {
        let bundled: BTreeSet<i64> = [0, 1, 2, 3].into_iter().collect();
        let read = |p: &Path| -> Option<Vec<(String, Vec<i64>)>> {
            match p.to_string_lossy().as_ref() {
                "a/aoi.vvm" => Some(vec![("雀松朱司".into(), vec![9001, 9002])]),
                "b/aoi.vvm" => Some(vec![("麒ヶ島宗麟".into(), vec![9002])]), // a と重なる
                "c/mid.vvm" => Some(vec![("黒沢冴白".into(), vec![9100])]),
                "d/zun.vvm" => Some(vec![("ずんだもん".into(), vec![3])]), // 同梱と重なる
                "e/liar.vvm" => Some(vec![("あいえるたん".into(), vec![9200])]), // 名前が違う
                "f/part.vvm" => Some(vec![("離途".into(), vec![9300])]),   // 書いた番号が中身に無い
                "g/dup.vvm" => Some(vec![("小夜/SAYO".into(), vec![9400, 9400])]), // 中身の中で重なる
                // 書いたキャラは使えるが、同じファイルに会社では許可が要るキャラが入っている（2026-10-16・13 §4）
                //   ＝書いたキャラは採る（同じファイルの使えないキャラは出さないだけ）
                "i/mix.vvm" => Some(vec![
                    ("春歌ナナ".into(), vec![9600]),
                    ("猫使アル".into(), vec![9601]),
                ]),
                // 1つのファイルに使えるキャラが2人＝両方採る（2つ目が「番号が重なる」で落ちない）
                "k/two.vvm" => Some(vec![
                    ("†聖騎士 紅桜†".into(), vec![9800]),
                    ("雀松朱司".into(), vec![9801]),
                ]),
                // i のファイルの猫使アルを書いた別のパック＝番号は i が押さえ済み
                "l/cat.vvm" => Some(vec![("猫使アル".into(), vec![9601])]),
                // 書いたキャラ自体が使えない（画面の門をすり抜けた manifest でも読ませない）
                "j/ng.vvm" => Some(vec![("後鬼".into(), vec![9700])]),
                _ => None, // h＝読めない
            }
        };
        let (acc, rej) = plan_voices(
            &bundled,
            vec![
                dv("a", "aoi", "雀松朱司", &[9001]),
                dv("b", "aoi", "麒ヶ島宗麟", &[9002]),
                dv("c", "mid", "黒沢冴白", &[9100]),
                dv("d", "zun", "ずんだもん", &[3]),
                dv("e", "liar", "満別花丸", &[9200]),
                dv("f", "part", "離途", &[9301]),
                dv("g", "dup", "小夜/SAYO", &[9400]),
                dv("h", "gone", "東北ずん子", &[9500]),
                dv("i", "mix", "春歌ナナ", &[9600]),
                dvf("i", "mix2", "mix", "猫使アル", &[9601]),
                dv("j", "ng", "後鬼", &[9700]),
                dvf("k", "a", "two", "†聖騎士 紅桜†", &[9800]),
                dvf("k", "b", "two", "雀松朱司", &[9801]),
                dv("l", "cat", "猫使アル", &[9601]),
            ],
            read,
        );
        let keys = |v: &[DeclaredVoice]| {
            v.iter()
                .map(|d| format!("{}/{}", d.pack_id, d.voice_id))
                .collect::<Vec<_>>()
        };
        assert_eq!(keys(&acc), vec!["a/aoi", "c/mid", "i/mix", "k/a", "k/b"]);
        assert_eq!(
            keys(&rej),
            vec![
                "b/aoi", "d/zun", "e/liar", "f/part", "g/dup", "h/gone", "i/mix2", "j/ng", "l/cat"
            ]
        );
    }

    #[test]
    fn vvm_styles_reads_metas() {
        use zip::write::SimpleFileOptions;
        let dir = std::env::temp_dir().join(format!("stario_vvm_{}", now_tag()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.vvm");
        {
            let mut w = zip::ZipWriter::new(fs::File::create(&p).unwrap());
            w.start_file("metas.json", SimpleFileOptions::default())
                .unwrap();
            w.write_all(r#"[{"name":"あおい","styles":[{"id":9001},{"id":9002}]}]"#.as_bytes())
                .unwrap();
            w.finish().unwrap();
        }
        assert_eq!(
            vvm_styles(&p),
            Some(vec![("あおい".to_string(), vec![9001, 9002])])
        );
        assert_eq!(vvm_styles(&dir.join("none.vvm")), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pack_audio_is_the_import_audio_list() {
        for ok in [
            "b/a.mp3", "b/a.M4A", "b/a.wav", "b/a.aac", "b/a.ogg", "b/a.flac",
        ] {
            assert!(is_pack_audio(Path::new(ok)), "{ok}");
        }
        for bad in ["t/intro.json", "f/a.otf", "a/logo.png", "run.exe", "noext"] {
            assert!(!is_pack_audio(Path::new(bad)), "{bad}");
        }
    }

    #[test]
    fn file_cap_matches_read_limits() {
        assert_eq!(file_cap(Path::new("t/intro.json")), MAX_TEXT_BYTES);
        assert_eq!(file_cap(Path::new("a/logo.png")), MAX_IMAGE_BYTES);
        assert_eq!(file_cap(Path::new("f/mincho.otf")), MAX_FONT_BYTES);
        assert_eq!(file_cap(Path::new("docs/readme.txt")), u64::MAX);
    }

    #[test]
    fn data_url_kind_reads_images_and_fonts_only() {
        let k = |p: &str| data_url_kind(Path::new(p));
        assert_eq!(k("a/logo.PNG"), Some(("image/png", MAX_IMAGE_BYTES)));
        assert_eq!(k("f/mincho.otf"), Some(("font/otf", MAX_FONT_BYTES)));
        assert_eq!(k("f/mincho.woff2"), Some(("font/woff2", MAX_FONT_BYTES)));
        assert_eq!(k("f/mincho.ttf").map(|x| x.1), Some(MAX_FONT_BYTES));
        for bad in ["t/intro.json", "run.exe", "noext", "a.svg"] {
            assert_eq!(k(bad), None, "{bad}");
        }
    }

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
