// 画面から「開く」を頼まれたときの**唯一の入口**（#1118）。
//
// ⚠️ **画面から任意の場所を渡せなくする**＝`open_path` は**プログラムを起動しうる**入口なので、
// 画面（WebView）から自由に指せる形にしない。アプリが**自分で作った場所**だけを覚えておき、
// その中からしか開かない。
//
// ⚠️ **なぜ作ったか**＝opener プラグインの `open_path` は開く前に**許可の範囲（scope）**を見るが、
// `capabilities/default.json` は `opener:allow-open-path` を**許可しているだけで範囲を1つも
// 書いていなかった**。`is_path_allowed` は最後に `allowed.iter().any(...)` を畳むので、
// **範囲が空なら必ず false**＝**どんな場所を渡しても通らなかった**。
// その結果、設定の「記録の場所を開く」も、書き出し完了の「動画を再生」も**必ず断られて**いた
//（隣の「保存した場所を開く」だけ通るのは `reveal_item_in_dir` に範囲の検査が無いため＝
// 「場所は開けるのに再生だけできない」という壊れ方の非対称は、ここから来ていた）。
//
// ⚠️ **範囲を書き足す道は採らない**＝書き出した動画は**利用者が保存先を選ぶ**ので範囲で表せない。
// 「書き忘れたら黙って全部弾かれる／書きすぎたら何でも開ける」の両方を、構造で無くす。
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// **アプリが自分で作った場所**（記録の置き場・いま書き出した動画）。
///
/// ⚠️ **process 全体で1つ**＝`AppHandle` を持ち回らない（`trouble_log` と同じ理由）。
/// ⚠️ **毒された錠でも止めない**（`unwrap` しない）＝開けないことでアプリを落とさない。
static PRODUCED: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

/// アプリが作った場所として覚える（あとで画面から開ける先になる）。
pub fn remember(path: &Path) {
    if let Ok(mut g) = PRODUCED.lock() {
        g.get_or_insert_with(HashSet::new)
            .insert(path.to_path_buf());
    }
}

/// 覚えているか（`open_produced_path` の関門そのもの）。
///
/// ⚠️ **文字列の一致で見る**＝`canonicalize` は**存在しないと失敗する**ので、
/// 消された動画を開こうとしたときに「覚えていない」と「もう無い」の区別がつかなくなる。
/// 覚える側も開く側も**同じ値**（アプリが組み立てたパス）なので、一致で足りる。
pub fn is_produced(path: &Path) -> bool {
    PRODUCED
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.contains(path)))
        .unwrap_or(false)
}

/// 覚えている数（検査用）。
#[cfg(test)]
pub fn produced_count() -> usize {
    PRODUCED
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.len()))
        .unwrap_or(0)
}

/// **アプリが作った場所だけ**を開く（画面からの唯一の入口）。
///
/// ⚠️ **断りは「次の行動」を示す**（§2-5）＝開けなかった理由が利用者に分かる形にする。
#[tauri::command]
pub fn open_produced_path(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !is_produced(&p) {
        // ⚠️ **画面には道筋を出さない**（§2-3）＝記録にだけ残す。
        crate::tlog!("opener", "not produced: {}", p.display());
        return Err(crate::messages::OPEN_NOT_ALLOWED.to_string());
    }
    if !p.exists() {
        return Err(crate::messages::OPEN_GONE.to_string());
    }
    app.opener().open_path(path, None::<&str>).map_err(|e| {
        crate::tlog!("opener", "open_path failed: {e}");
        crate::messages::OPEN_FAILED.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **覚えていない場所は開かない**＝画面から任意の場所を渡しても通らない。
    #[test]
    fn 覚えていない場所は通さない() {
        let p = std::env::temp_dir().join("stario-not-produced.mp4");
        assert!(!is_produced(&p), "覚えていないのに通っている");
    }

    /// **覚えた場所は通る**＝アプリが作ったものは開ける。
    #[test]
    fn 覚えた場所は通す() {
        let p = std::env::temp_dir().join(format!("stario-produced-{}.mp4", std::process::id()));
        let before = produced_count();
        remember(&p);
        assert!(is_produced(&p), "覚えたのに通らない");
        assert_eq!(produced_count(), before + 1, "覚えた数が増えていない");
        // ⚠️ **似た名前まで通さない**＝前方一致などで広げていないこと。
        let near =
            std::env::temp_dir().join(format!("stario-produced-{}.mp4.bak", std::process::id()));
        assert!(!is_produced(&near), "似た名前まで通している");
    }
}
