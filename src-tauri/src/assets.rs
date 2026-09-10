// プロジェクトのファイル（素材画像・ナレーション音声）の取り込み/読み出し（infrastructure 境界）。
// プロジェクトフォルダ <appData>/projects/<id>/{assets,voices}/ に保管し、相対パスを project.json に持つ（11 §7.2）。
// 描画は data URL（ADR-0004：canvas汚染回避）なので、読み出しは data URL を返す（音声も同形式で復元）。
use base64::Engine as _;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

pub fn project_dir(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    if !crate::is_safe_project_id(project_id) {
        return Err("この動画を開けませんでした。動画の一覧から開き直してください。".to_string());
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

/// 「フォルダの直下に1つ置く名前」として受けてよいか（#260・PR #887 レビュー 🔴）。
///
/// ⚠️ **コロンも弾く**＝Windows の**ドライブ相対パス**（`C:evil.txt`）を `PathBuf::join` へ渡すと、
/// **それまでの中身が丸ごと置き換わる**（prefix はあるが root が無い形の仕様）。
/// つまり `assets/` の下に置いたつもりが**別のドライブのカレント**に書かれる。
/// `/`・`\`・`..` だけを見ていると、この形だけがすり抜ける。
///
/// ⚠️ **呼ぶ側が正しい名前を作っている、を前提にしない**＝webview から直接 `invoke` されうる
///（他のコマンドも同じ理由で自前で検査している）。
pub fn is_safe_single_file_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains(':')
        && !name.contains("..")
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
        return Err("そのファイルは扱えません。素材の一覧から選び直してください。".to_string());
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
    let project_id = header("projectId").ok_or_else(|| {
        "取り込みの情報が足りません。もう一度取り込み直してください。".to_string()
    })?;
    let file_name = header("fileName").ok_or_else(|| {
        "取り込みの情報が足りません。もう一度取り込み直してください。".to_string()
    })?;
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

/// 渡したプロジェクト相対パスのファイルを消す（#348）。消せた数を返す。
///
/// 素材を消したときに**プロジェクトフォルダにファイルだけ残る**のを防ぐ。
/// **止まらない**＝消せないものがあっても残りを続ける（素材はもう文書から外れており、
/// 残ったファイルは次の取り込みで上書きされるだけの無害な余りなので、ここで失敗にしない）。
///
/// ⚠️ **消せるのは `assets/` の下だけ**（`delete_template_asset` が `tmpl_asset_` 接頭辞で守るのと同じ流儀）。
/// `is_safe_rel_path` はプロジェクトの外を弾くが、**中なら何でも**消せてしまう＝`project.json` や
/// `voices/*.wav` まで届く。**破壊的なコマンドは範囲を狭く取る**（呼び出し側の間違いを型では防げない）。
/// `asset_dest` が書き込む先と同じ場所に揃えてある。
#[tauri::command]
pub fn delete_project_files(
    app: tauri::AppHandle,
    project_id: String,
    rel_paths: Vec<String>,
) -> Result<usize, String> {
    let dir = project_dir(&app, &project_id)?;
    let mut removed = 0usize;
    for rel in rel_paths {
        if !is_safe_rel_path(&rel) || !rel.starts_with("assets/") {
            continue;
        }
        let path = dir.join(&rel);
        if path.is_file() && fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
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
        return Err("そのファイルは扱えません。素材の一覧から選び直してください。".to_string());
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
/// **プロジェクト相対パスを受け取る全コマンドがこの1関数を通る**（read_asset_data_url・焼き出しのコピー/容量・
/// 書き出しの素材解決）＝どれか一方だけを直して安全条件が静かに乖離するのを防ぐ。
///
/// ⚠️ **コロンも弾く**（#893）＝Windows の**ドライブ相対パス**（`C:evil.txt`）は
/// **prefix はあるが root が無い**ので `Path::is_absolute()` が **`false`** を返し、
/// `..`・先頭の区切り・絶対パスの検査を**すべてすり抜ける**。しかし `PathBuf::join` へ渡すと
/// **それまでの中身が丸ごと置き換わる**ので、プロジェクトの外へ書ける。
/// `is_safe_single_file_name`（`/` も弾く）とは**別関数のまま**＝こちらは下位ディレクトリを許すので
/// `/` を弾けない。共通なのは「コロン・`..`・空」の3つだけ。
pub fn is_safe_rel_path(rel_path: &str) -> bool {
    !rel_path.is_empty()
        && !rel_path.contains("..")
        && !rel_path.contains(':')
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
            return Err("そのファイルは扱えません。素材の一覧から選び直してください。".to_string());
        }
        if let Ok(meta) = fs::metadata(dir.join(rel)) {
            total = total.saturating_add(meta.len());
        }
    }
    Ok(total)
}

/// プロジェクト間のコピーの**中止要求**（#1021）。
///
/// ⚠️ **呼び出しごとに分ける**（PR #1054 レビュー 🔴）＝1つの真偽値にすると**プロセス全体で共有**され、
/// 焼き出しの中止が**並行して走っている複製**を巻き込む（逆に、複製の開始が焼き出しの中止を握りつぶす）。
/// 呼ぶ側が渡した `copy_id` で覚える＝**自分の回だけ**止まる。
static CANCELLED_COPIES: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn cancelled_copies() -> std::sync::MutexGuard<'static, Option<HashSet<String>>> {
    // 毒されても中身を取り出して続ける（中止できないより、続けられるほうがまし）。
    CANCELLED_COPIES.lock().unwrap_or_else(|e| e.into_inner())
}

/// 走行中のコピーを中止する（#1021）。ユーザーの「中止」から呼ぶ。副作用のみ（表示は呼び出し側）。
#[tauri::command]
pub fn cancel_project_copy(copy_id: String) {
    cancelled_copies()
        .get_or_insert_with(HashSet::new)
        .insert(copy_id);
}

/// コピーの結果（#1021）。⚠️ **中止は失敗と分けて返す**＝`Err` の文字列で見分けると、
/// **同じ文字列を呼ぶ側にも持つ**ことになり（§2-7 違反）、言い回しを変えたとたんに失敗として扱われる。
#[derive(Clone, serde::Serialize)]
pub struct CopyResult {
    /// 実際に運んだ件数（元に無いファイルは飛ばすので、渡した数より少ないことがある）。
    pub copied: usize,
    /// 利用者が中止したか（運んだものは片づけ済み）。
    pub cancelled: bool,
}

#[derive(Clone, serde::Serialize)]
struct CopyProgressEvent {
    step: usize,
    total: usize,
}

/// 焼き出し（ADR-0032）でプロジェクト間にファイルをコピーする。
/// 相対パスの構造（assets/…・voices/…）はそのまま保ち、コピー先の親ディレクトリは作る。
/// **元プロジェクトには一切書き込まない**（片道＝決定16）。
///
/// 素材を丸ごと運ぶので分単位になりうる（#1021）＝**進み具合を送り、中止を受ける**。
/// ⚠️ **中止・失敗のどちらでも運んだものを片づける**＝途中まで運んだフォルダを残すと、素材だけがあって
/// `project.json` が無い状態になり、一覧にも出ない**見えないゴミ**が残る。
/// ⚠️ **片づけるのは「自分が運んだファイル」だけ**（フォルダを丸ごと消さない）＝
/// 消してよいものだけを消す。空になった入れ物はその後で畳む。
#[tauri::command]
pub fn copy_project_files(
    app: tauri::AppHandle,
    src_project_id: String,
    dest_project_id: String,
    rel_paths: Vec<String>,
    copy_id: String,
) -> Result<CopyResult, String> {
    if src_project_id == dest_project_id {
        return Err("同じ場所へは複製できません。別の場所を選んでください。".to_string());
    }
    // 入口で自分の回の印を落とす＝前回の中止要求を持ち越さない（同じ id を再利用しても止まらない）。
    if let Some(set) = cancelled_copies().as_mut() {
        set.remove(&copy_id);
    }
    let src_dir = project_dir(&app, &src_project_id)?;
    let dest_dir = project_dir(&app, &dest_project_id)?;
    let total = rel_paths.len();
    let mut copied: Vec<PathBuf> = Vec::new();
    for (i, rel) in rel_paths.iter().enumerate() {
        if !is_safe_rel_path(rel) {
            cleanup_copied(&copied, &dest_dir);
            return Err("そのファイルは扱えません。素材の一覧から選び直してください。".to_string());
        }
        if is_copy_cancelled(&copy_id) {
            cleanup_copied(&copied, &dest_dir);
            return Ok(CopyResult {
                copied: 0,
                cancelled: true,
            });
        }
        let src = src_dir.join(rel);
        // 元に無いファイルは飛ばす（未配置のサンプル素材など）。欠けたぶんは焼いた側で
        // 「素材が見つかりません」として扱われる（15 §6）＝ここで丸ごと失敗させない。
        if src.is_file() {
            let dest = dest_dir.join(rel);
            // ⚠️ **失敗したときも片づける**（PR #1054 レビュー 🟡）＝中止だけ片づけて失敗を残すと、
            // 「見えないゴミを残さない」が**失敗系では守れない**（同じ状態が別の入口からできる）。
            if let Some(parent) = dest.parent() {
                if fs::create_dir_all(parent).is_err() {
                    cleanup_copied(&copied, &dest_dir);
                    return Err(ASSET_SAVE_ERR.to_string());
                }
            }
            if fs::copy(&src, &dest).is_err() {
                cleanup_copied(&copied, &dest_dir);
                return Err(ASSET_SAVE_ERR.to_string());
            }
            copied.push(dest);
        }
        // 進み具合は best-effort（送れなくてもコピーは続ける＝書き出しと同じ流儀）。
        let _ = app.emit("copy_progress", CopyProgressEvent { step: i + 1, total });
    }
    // 終わったら自分の印を片づける（覚えっぱなしにしない）。
    if let Some(set) = cancelled_copies().as_mut() {
        set.remove(&copy_id);
    }
    Ok(CopyResult {
        copied: copied.len(),
        cancelled: false,
    })
}

/// この回のコピーが中止されたか。
fn is_copy_cancelled(copy_id: &str) -> bool {
    cancelled_copies()
        .as_ref()
        .is_some_and(|set| set.contains(copy_id))
}

/// 中止・失敗したときの後始末＝**自分が運んだファイル**を消し、空になった入れ物を畳む（#1021）。
///
/// ⚠️ **畳むのは「自分が作った入れ物」まで**＝コピー先の中の空になった入れ物と、コピー先そのもの
/// （このコマンドは**新しいプロジェクト**へ運ぶ用途しか無いので、空になったなら誰も使っていない）。
/// 中身が残っていれば `remove_dir` が失敗して残る＝**消してよいものだけが消える**。
fn cleanup_copied(copied: &[PathBuf], dest_dir: &Path) {
    for p in copied {
        let _ = fs::remove_file(p);
    }
    // ⚠️ **途中の入れ物も畳む**（同レビュー ℹ️）＝直接の親だけだと、2階層以上のときに空の中間が残る。
    let mut dirs: Vec<PathBuf> = Vec::new();
    for p in copied {
        let mut cur = p.parent();
        while let Some(d) = cur {
            if !d.starts_with(dest_dir) || d == dest_dir {
                break;
            }
            dirs.push(d.to_path_buf());
            cur = d.parent();
        }
    }
    dirs.sort();
    dirs.dedup();
    // 深い所から畳む（中が空になってから外側を見る）。
    dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
    for d in dirs {
        let _ = fs::remove_dir(&d);
    }
    let _ = fs::remove_dir(dest_dir);
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
                crate::tlog!("template_assets", "エントリ読み込みスキップ: {}", e);
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
            Err(e) => crate::tlog!("template_assets", "読み込みスキップ {:?}: {}", path, e),
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
        return Err(
            "この素材が見つかりませんでした。素材の一覧から選び直してください。".to_string(),
        );
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

    /// 中止の印は**回ごと**に持つ（#1021・PR #1054 レビュー 🔴）＝1つの真偽値だと、
    /// 焼き出しの中止が**並行して走っている複製**を巻き込む（逆も同じ）。
    #[test]
    fn cancel_is_per_copy() {
        cancel_project_copy("bake_1".to_string());
        assert!(is_copy_cancelled("bake_1"), "止めた回が止まっていない");
        assert!(!is_copy_cancelled("dup_1"), "別の回まで巻き込んだ");
        // 片づけ（テスト間で持ち越さない）。
        if let Some(set) = cancelled_copies().as_mut() {
            set.remove("bake_1");
        }
    }

    /// 途中の入れ物も畳む（#1021・同レビュー ℹ️）＝直接の親だけだと、2階層以上で空の中間が残る。
    #[test]
    fn cleanup_folds_nested_dirs() {
        let base = std::env::temp_dir().join(format!("stario_cleanup3_{}", std::process::id()));
        let dest = base.join("dest");
        let deep = dest.join("assets").join("sub");
        fs::create_dir_all(&deep).unwrap();
        let a = deep.join("a.png");
        fs::write(&a, b"x").unwrap();

        cleanup_copied(std::slice::from_ref(&a), &dest);

        assert!(!deep.exists(), "いちばん内側が残った");
        assert!(!dest.join("assets").exists(), "途中の入れ物が残った");
        assert!(!dest.exists(), "コピー先が残った");
        let _ = fs::remove_dir_all(&base);
    }

    /// 中止したときの後始末（#1021）。**自分が運んだファイルだけ**を消し、空になった入れ物を畳む。
    /// ⚠️ **運んでいないものは消さない**＝コピー先に元からあるものを巻き込まない。
    #[test]
    fn cleanup_removes_only_copied_files() {
        let base = std::env::temp_dir().join(format!("stario_cleanup_{}", std::process::id()));
        let dest = base.join("dest");
        let assets = dest.join("assets");
        fs::create_dir_all(&assets).unwrap();
        let mine = assets.join("asset_001.png");
        let theirs = assets.join("keep.png");
        fs::write(&mine, b"x").unwrap();
        fs::write(&theirs, b"y").unwrap();

        cleanup_copied(std::slice::from_ref(&mine), &dest);

        assert!(!mine.exists(), "運んだファイルが残った");
        assert!(theirs.exists(), "運んでいないファイルまで消した");
        assert!(assets.exists(), "中身が残っている入れ物を畳んだ");
        let _ = fs::remove_dir_all(&base);
    }

    /// 中止して**全部片づいたら**、空になった入れ物とコピー先そのものも畳む
    /// （素材だけがあって project.json が無い＝一覧に出ない**見えないゴミ**を残さない）。
    #[test]
    fn cleanup_folds_empty_dirs() {
        let base = std::env::temp_dir().join(format!("stario_cleanup2_{}", std::process::id()));
        let dest = base.join("dest");
        let assets = dest.join("assets");
        fs::create_dir_all(&assets).unwrap();
        let a = assets.join("a.png");
        fs::write(&a, b"x").unwrap();

        cleanup_copied(&[a], &dest);

        assert!(!assets.exists(), "空になった入れ物が残った");
        assert!(!dest.exists(), "空になったコピー先が残った");
        let _ = fs::remove_dir_all(&base);
    }

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
        // 弾く：**ドライブ相対パス**（#893）＝`C:evil.txt` は prefix はあるが root が無いので
        // `Path::is_absolute()` が **false** を返し、上の検査を**すべてすり抜ける**。しかし
        // `PathBuf::join` へ渡すと**中身が丸ごと置き換わり**、プロジェクトの外へ書ける。
        assert!(!is_safe_rel_path("C:evil.txt"));
        assert!(!is_safe_rel_path("c:a.png"));
        assert!(!is_safe_rel_path("assets/C:evil.txt"));
        // 弾く：Windows の絶対パス（ドライブレター・UNC）。
        assert!(!is_safe_rel_path("C:\\Windows\\System32"));
        assert!(!is_safe_rel_path("\\\\server\\share\\a.png"));
        // 弾く：空（プロジェクトフォルダ自身を指す＝ファイルではない）。
        assert!(!is_safe_rel_path(""));
    }

    /// 消せる範囲が `assets/` に閉じているか（#348・PR #875 レビュー）。
    ///
    /// ⚠️ **`is_safe_rel_path` だけでは足りない**＝あれは「プロジェクトの外」を弾くだけで、
    /// **中なら何でも**通る（`project.json` も `voices/*.wav` も）。破壊的なコマンドは
    /// `delete_template_asset` の接頭辞と同じ流儀で**範囲を狭く**取る。
    ///
    /// ⚠️ **Windows のドライブ相対（`C:foo`＝バックスラッシュ無し）は `is_absolute()` が false**。
    /// 以前はここを `is_safe_rel_path` が通してしまい、**`starts_with("assets/")` の文字列比較だけが
    /// 防いでいた**（この関数の外では守られていない＝#893 で書き出しの経路に穴が空いていた）。
    /// **いまは `is_safe_rel_path` がコロンを弾く**ので、範囲の限定と入口の検査の**二重で**守る。
    #[test]
    fn delete_scope_is_assets_only() {
        // この関数が実際に使う条件（`delete_project_files` の continue と同じ式）。
        let deletable = |rel: &str| is_safe_rel_path(rel) && rel.starts_with("assets/");
        // 通す：素材の実体と代表フレーム（`asset_dest` が書く先と同じ）。
        assert!(deletable("assets/asset_001.png"));
        assert!(deletable("assets/asset_001_thumb.png"));
        // 弾く：プロジェクト配下でも素材ではないもの。
        assert!(!deletable("project.json"));
        assert!(!deletable("voices/scene_001.wav"));
        assert!(!deletable("cache/asset_001_strip.png"));
        // 弾く：ドライブ相対。⚠️ **入口の `is_safe_rel_path` が落とす**（#893 で塞いだ）。
        // ここで `deletable` も見るのは、**範囲の限定だけでも守れている**ことを残すため
        //（入口の検査が将来ゆるんでも、この関数だけは `assets/` の外へ出ない）。
        assert!(!is_safe_rel_path("C:assets/evil.txt"));
        assert!(!deletable("C:assets/evil.txt"));
        // 弾く：親への相対参照（先に `is_safe_rel_path` が落とす）。
        assert!(!deletable("assets/../project.json"));
        assert!(!deletable("assets\\..\\project.json"));
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

#[cfg(test)]
mod safe_name_tests {
    use super::is_safe_single_file_name;

    /// ⚠️ **Windows のドライブ相対パスを弾く**（PR #887 レビュー 🔴）＝`PathBuf::join` へ渡すと
    /// **それまでの中身が丸ごと置き換わる**（別のドライブのカレントに書かれる）。
    #[test]
    fn rejects_drive_relative_path() {
        assert!(!is_safe_single_file_name("C:evil.txt"));
        assert!(!is_safe_single_file_name("c:a.png"));
        assert!(!is_safe_single_file_name("asset:001.png")); // コロンは一律で断る（安全側）
    }

    #[test]
    fn rejects_path_pieces() {
        assert!(!is_safe_single_file_name(""));
        assert!(!is_safe_single_file_name("a/b.png"));
        assert!(!is_safe_single_file_name("a\\b.png"));
        assert!(!is_safe_single_file_name("../x.png"));
    }

    #[test]
    fn accepts_plain_names() {
        assert!(is_safe_single_file_name("asset_001.png"));
        assert!(is_safe_single_file_name("日本語の名前.mp4"));
    }
}

/// **相対パスの検査を写し直させない門番**（#893）。
///
/// ⚠️ **型では守れない**＝`ffmpeg.rs` が `rel_path.starts_with('/')` を自前で書いても
/// コンパイルは通る。実際にそうなっており、`assets.rs` にコロンの検査を足しても
/// **書き出しの経路だけ古いまま**だった。規則を写した瞬間に落ちるようにしておく。
#[cfg(test)]
mod rel_path_single_source_guard {
    /// `resolve_project_file` は `is_safe_rel_path` に委ねる（自前で条件を並べない）。
    #[test]
    fn 書き出しの経路は検査を写さない() {
        let src = include_str!("ffmpeg.rs");
        assert!(
            src.contains("crate::assets::is_safe_rel_path(rel_path)"),
            "resolve_project_file が共有の検査を通っていない（規則を写すと片方だけ古くなる）",
        );
        for copied in [
            "rel_path.starts_with('/')",
            "Path::new(rel_path).is_absolute()",
            // ⚠️ **1つぶんの名前の検査も写さない**（α-6 出口監査 ℹ️）＝写しはコロンだけ落ちていた。
            "!name.contains('/')",
        ] {
            assert!(
                !src.contains(copied),
                "相対パスの検査が写し直されている: {copied}（`is_safe_rel_path` へ委ねる）",
            );
        }
    }
}
