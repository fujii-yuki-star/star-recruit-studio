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

/// 覚える置き場（`Mutex`）を**引数で受ける**形（中身）。
///
/// ⚠️ **切り出してあるのは検査が実装を通るため**（`trouble_log.rs` の `record_to` と同じ流儀）＝
/// 「毒された錠でも落ちない」を確かめるには**錠を毒す**必要があるが、process 全体で1つの
/// `PRODUCED` を毒すと**他の検査まで巻き添え**にする（実際にそうなった）。
/// 検査は**自前の錠**を渡して、同じ道を通す。
type Produced = Mutex<Option<HashSet<PathBuf>>>;

fn remember_in(lock: &Produced, path: &Path) {
    if let Ok(mut g) = lock.lock() {
        g.get_or_insert_with(HashSet::new)
            .insert(path.to_path_buf());
    }
}

fn contains_in(lock: &Produced, path: &Path) -> bool {
    lock.lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.contains(path)))
        .unwrap_or(false)
}

/// アプリが作った場所として覚える（あとで画面から開ける先になる）。
pub fn remember(path: &Path) {
    remember_in(&PRODUCED, path);
}

/// 覚えているか（`guard_produced` の材料）。
///
/// ⚠️ **文字列の一致で見る**＝`canonicalize` は**存在しないと失敗する**ので、
/// 消された動画を開こうとしたときに「覚えていない」と「もう無い」の区別がつかなくなる。
/// 覚える側も開く側も**同じ値**（アプリが組み立てたパス）なので、一致で足りる。
/// ⚠️ **だから「同じ値」を崩さない**＝保存先は**Rust の戻り値**から採る（ダイアログで選ばれた
/// 文字列をそのまま使うと、拡張子を補ったときに食い違う＝`timelineStore.ts` の注記）。
pub fn is_produced(path: &Path) -> bool {
    contains_in(&PRODUCED, path)
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

/// 開いてよいかの**関門**（`AppHandle` を要らない**純粋関数**にする）。
///
/// ⚠️ **切り出す理由**（レビュー由来 🔴・2026-09-11）＝コマンド本体は `AppHandle` が要るので
/// 単体で叩けず、門番は「`if !is_produced(` という**字面があるか**」しか見られなかった。
/// その形だと、**中身の `return Err` を消す**変異が捕まらない（判定は残るが関門は効かない）。
/// 分岐そのものを検査できる形にする。
///
/// ⚠️ **断りを2つに分ける**＝「覚えていない」（何かが壊れている）と「もう無い」（移動・削除）は
/// 利用者の次の行動が違う（§2-5）。
pub fn guard_produced(path: &Path) -> Result<(), &'static str> {
    if !is_produced(path) {
        return Err(crate::messages::OPEN_NOT_ALLOWED);
    }
    if !path.exists() {
        return Err(crate::messages::OPEN_GONE);
    }
    Ok(())
}

/// **アプリが作った場所だけ**を開く（画面からの唯一の入口）。
///
/// ⚠️ **断りは「次の行動」を示す**（§2-5）＝開けなかった理由が**画面まで届く**
/// （呼ぶ側は `userFacingMessage` で受けて出す＝`src/app/userFacingError.ts`）。
#[tauri::command]
pub fn open_produced_path(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Err(msg) = guard_produced(&p) {
        // ⚠️ **画面には道筋を出さない**（§2-3）＝どの場所だったかは記録にだけ残す。
        crate::tlog!("opener", "refused: {} ({})", p.display(), msg);
        return Err(msg.to_string());
    }
    app.opener().open_path(path, None::<&str>).map_err(|e| {
        crate::tlog!("opener", "open_path failed: {e}");
        // ⚠️ **断りを取り違えない**（レビュー由来 ℹ️）＝関門を通ってから開くまでの間に消されると、
        // 「開くためのアプリが入っているかご確認ください」と**見当違いの次の行動**を出してしまう。
        // もう一度だけ在るかを見て、無ければ「もう無い」へ倒す。
        if !p.exists() {
            return crate::messages::OPEN_GONE.to_string();
        }
        crate::messages::OPEN_FAILED.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// **覚えていない場所は開かない**＝画面から任意の場所を渡しても通らない。
    #[test]
    fn 覚えていない場所は通さない() {
        let p = std::env::temp_dir().join("stario-not-produced.mp4");
        assert!(!is_produced(&p), "覚えていないのに通っている");
    }

    /// **関門そのものを叩く**（レビュー由来 🔴）＝`return Err` を消す変異を捕まえる。
    #[test]
    fn 関門は覚えていない場所を断る() {
        let p = std::env::temp_dir().join("stario-guard-unknown.mp4");
        assert_eq!(
            guard_produced(&p),
            Err(crate::messages::OPEN_NOT_ALLOWED),
            "覚えていないのに通している"
        );
    }

    /// **覚えていても、無ければ別の断り**＝利用者の次の行動が違う（§2-5）。
    #[test]
    fn 関門は覚えていても無いものを断る() {
        let p = std::env::temp_dir().join(format!("stario-guard-gone-{}.mp4", std::process::id()));
        let _ = fs::remove_file(&p);
        remember(&p);
        assert_eq!(
            guard_produced(&p),
            Err(crate::messages::OPEN_GONE),
            "無いのに通している／断りが取り違えられている"
        );
    }

    /// **覚えていて在るものは通す**＝関門が締めすぎていない。
    #[test]
    fn 関門は覚えていて在るものを通す() {
        let p = std::env::temp_dir().join(format!("stario-guard-ok-{}.mp4", std::process::id()));
        fs::write(&p, b"x").unwrap();
        remember(&p);
        assert_eq!(guard_produced(&p), Ok(()), "覚えていて在るのに通らない");
        let _ = fs::remove_file(&p);
    }

    /// **毒された錠でも落ちない**（この file の冒頭に書いた主張を、実際に確かめる）。
    ///
    /// ⚠️ **書いたのに検査していなかった**（レビュー由来 🟡）＝`CLAUDE.md §7`
    /// 「自分がコメントに書いた主張も変異にする」。
    #[test]
    fn 毒された錠でも落ちない() {
        // ⚠️ **共有の `PRODUCED` は毒さない**＝process 全体で1つなので、毒すと**他の検査まで
        // 巻き添え**になる（実際にそうなって2件落ちた）。同じ道（`remember_in`/`contains_in`）へ
        // **自前の錠**を渡す。
        static LOCAL: Produced = Mutex::new(None);
        let poisoned = std::thread::spawn(|| {
            let _g = LOCAL.lock().unwrap();
            panic!("わざと毒す");
        })
        .join();
        assert!(poisoned.is_err(), "毒せていない＝この検査が空振りしている");
        let p = std::env::temp_dir().join("stario-poisoned.mp4");
        // ⚠️ **落ちないこと**が見たい（毒された後は覚えられない＝安全側に倒れる）。
        remember_in(&LOCAL, &p);
        assert!(!contains_in(&LOCAL, &p), "毒された錠なのに覚えている");
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
