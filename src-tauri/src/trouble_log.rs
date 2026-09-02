// うまくいかないときの記録（#396）。技術詳細を **このパソコンの中だけ** に残す。
//
// ⚠️ **配布版では stderr がどこにも残らない**（MSI で入れたアプリはコンソールを持たない）＝
// 利用者から「失敗しました」と言われても、調べる材料が何も無かった。§2-5 は画面に「次の行動」を出すが、
// **作った側が原因を追う材料**は別に要る。
// ⚠️ **外へは何も送らない**（§2-6）＝ここは書き出すだけ。送るかどうかは利用者が場所を開いて自分で決める。
// ⚠️ **画面には出さない**（§2-3）＝ここに入るのは実装の言葉（FFmpeg の stderr など）。
//   画面に出すのは「記録の場所を開く」導線だけ。
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

/// 記録の置き場（`appData/logs`）。**起動時に一度だけ**決める。
///
/// ⚠️ **`AppHandle` を持ち回らない**＝技術詳細を出す所は 68 か所以上あり、そこへ引数を足して回ると
/// 差分が広がるうえ、**足し忘れた所だけ記録が残らない**（片方だけ直す型）。process 全体で1つ持つ。
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// 書き込みの順番待ち。
///
/// ⚠️ **同時に書くと記録が消えうる**（#957 レビュー）＝Tauri のコマンドは既定で並行に走るので、
/// 「書き出しが失敗した」と「画面側が同時に何件も警告を出した」が重なると、`rotate_if_needed` の
/// **サイズ確認→削除→リネーム**が競合して片方の行が落ちる。**複数箇所が同時にこけたときの調査材料**が
/// この記録の存在意義なので、まさにその場面で消えるのはいちばん困る。
/// ⚠️ **頻度は低いので待たせて構わない**（失敗したときにしか書かない）。
/// ⚠️ **毒された錠でも書き続ける**（`unwrap` しない）＝記録を残せないことでアプリを落とさない。
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// いま開いている記録のファイル（**開き直しを避ける**ため持ち続ける・置き場ごと）。
static OPEN_FILE: Mutex<Option<(PathBuf, std::fs::File)>> = Mutex::new(None);

/// 1つのファイルの上限。超えたら1世代だけ退避する。
/// ⚠️ **無制限にしない**＝長く使うと際限なく太る。**世代を増やしすぎない**＝調べたいのは直近の失敗。
const MAX_BYTES: u64 = 2 * 1024 * 1024;

/// 起動時に置き場を決めて作る（`lib.rs` の `setup` から呼ぶ）。
///
/// ⚠️ **失敗しても起動は止めない**＝記録が残せないのは環境の事情で、そこでアプリが使えなくなるほうが重い。
/// 残せないときは従来どおり stderr にだけ出る（dev では見える）。
pub fn init(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Ok(base) = app.path().app_data_dir() else {
        return;
    };
    let dir = base.join("logs");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = LOG_DIR.set(dir);
}

/// 記録の置き場（無ければ `None`）。画面へ渡して「場所を開く」に使う。
pub fn dir() -> Option<PathBuf> {
    LOG_DIR.get().cloned()
}

/// 技術詳細を1行残す。**stderr にも出す**（dev のコンソールは従来どおり）。
///
/// ⚠️ **時刻を付ける**＝いつの失敗か分からないと、複数回試した中のどれかが特定できない。
/// ⚠️ **改行は潰す**＝FFmpeg の stderr は複数行で来るので、1件が1行になるようにする（読み返しやすさ）。
pub fn record(tag: &str, detail: &str) {
    eprintln!("[{tag}] {detail}");
    let Some(dir) = LOG_DIR.get() else { return };
    record_to(dir, tag, detail, MAX_BYTES);
}

/// 置き場と上限を受け取って1行残す（`record` の中身）。
///
/// ⚠️ **切り出してあるのはテストが実装を通るため**（#957 レビュー）＝`record` は置き場を
/// process 全体の `OnceLock` から採るので、テストからは**他のテストが先に設定していると早期 return** し、
/// 何も試していないのに緑になる（実際そうなっていた）。上限も渡せるようにして、
/// **退避が何度も起きる状況**を作れるようにする（1回しか退避しないと競合そのものを踏まない）。
fn record_to(dir: &std::path::Path, tag: &str, detail: &str, max_bytes: u64) {
    let path = dir.join("stario.log");
    // ⚠️ **札の側も1行に潰す**（#957 レビュー）＝いまは固定の言葉だが、可変にする改修が入ったとき
    // 改行が混じると「時刻・札・中身」の並びが黙って崩れる（気づける形になっていない）。
    let line = format!(
        "{}\t[{}]\t{}\n",
        now_stamp(),
        one_line(tag),
        one_line(detail)
    );
    // ⚠️ **確認→退避→書き込みをひとまとまりにする**＝間に別の書き込みが割り込むと行が落ちる。
    let _guard = WRITE_LOCK.lock();
    #[cfg(test)]
    let _watch = probe::Guard::enter();
    rotate_if_needed(&path, max_bytes);
    // ⚠️ **開いたまま持ち続ける**（α-7 出口監査の未対応項目・#958）＝1件ごとに開き直していたが、
    // 実測すると **開くのに 13.8ms・書くのは 6us**（Windows）＝ほぼ全部が開き直しの代金だった。
    // 書き出しの警告は続けて来るので、そのぶん画面が固まる。**開くのを1回にする**と 2000 倍速くなる。
    // ⚠️ **溜めてから書くのではない**＝`File` は素通しなので、**落ちたときに残る量は変わらない**
    //（記録は「うまくいかないとき」に読むものなので、そこを弱めては本末転倒）。
    let Ok(mut slot) = OPEN_FILE.lock() else {
        return;
    };
    let reopen = match slot.as_ref() {
        Some((have, _)) => have != &path,
        None => true,
    };
    if reopen {
        #[cfg(test)]
        probe::OPENS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        *slot = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .ok()
            .map(|f| (path.clone(), f));
    }
    if let Some((_, f)) = slot.as_mut() {
        let _ = f.write_all(line.as_bytes());
    }
}

/// 持っている控えを手放す（退避の前・置き場が変わったとき）。
fn close_open_file() {
    if let Ok(mut slot) = OPEN_FILE.lock() {
        *slot = None;
    }
}

/// 1件を1行に潰す。
///
/// ⚠️ **FFmpeg の出力は複数行で来る**ので、そのまま書くと1件が何行にもなり、あとから
/// 「どこからどこまでが1回の失敗か」が読めない。**切り出してある**のは、テストが**実装を通る**
/// ようにするため（テストの中で同じ式を書き直すと、実装を変えても落ちない＝変異チェックで素通りした）。
fn one_line(detail: &str) -> String {
    detail.replace('\r', "").replace('\n', " / ")
}

/// **テストのときだけ**、「同時に何本が中に居たか」を測る見張り。
///
/// ⚠️ **守りたいのは「ひとまとまりであること」そのもの**（#957 レビュー）なので、それを直接測る。
/// ファイルの最後の状態を見る形にしていたが、**毎回退避する設定では最後の1本が書き直すので勝手に整い**、
/// 錠を外しても緑のままだった（＝確かめられていなかった）。
/// ⚠️ **少し待つ**のは、待たないと窓が狭すぎて重ならないから（錠がある側は中で待つだけなので影響しない）。
/// ⚠️ **眠らずに回して待つ**＝`sleep(200us)` は **Windows では実際に約 15.6ms 眠る**（時計の刻みが粗い）。
/// 窓を開ける目的には長すぎるうえ、**書き込みの速さを測るテストがその15.6msを測ってしまう**
///（実際に「1件 16ms」という嘘の数字が出た）。
/// ⚠️ **配布されるものには入らない**（`cfg(test)`）＝実際の書き込みは遅くならない。
#[cfg(test)]
mod probe {
    use std::sync::atomic::{AtomicUsize, Ordering};
    pub static NOW: AtomicUsize = AtomicUsize::new(0);
    pub static MAX: AtomicUsize = AtomicUsize::new(0);
    /// ファイルを**開いた回数**（開き直していないことを見る）。
    pub static OPENS: AtomicUsize = AtomicUsize::new(0);
    /// ⚠️ **記録を書くテスト同士を並ばせる**＝この module は錠も開いたファイルも**process にひとつ**なので、
    /// 並行に走らせると互いの置き場で開き直しが起き、**測っているものが変わる**
    ///（実際、単独なら 358us/件のところが、並行だと 15490us/件という嘘の数字になった）。
    pub static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());
    pub struct Guard;
    impl Guard {
        pub fn enter() -> Self {
            let n = NOW.fetch_add(1, Ordering::SeqCst) + 1;
            MAX.fetch_max(n, Ordering::SeqCst);
            let until = std::time::Instant::now() + std::time::Duration::from_micros(200);
            while std::time::Instant::now() < until {
                std::hint::spin_loop();
            }
            Guard
        }
    }
    impl Drop for Guard {
        fn drop(&mut self) {
            NOW.fetch_sub(1, Ordering::SeqCst);
        }
    }
}

/// 上限を超えていたら1世代だけ退避する（`stario.log` → `stario.1.log`）。
fn rotate_if_needed(path: &PathBuf, max_bytes: u64) {
    let Ok(meta) = fs::metadata(path) else {
        // ⚠️ **無くなっていたら控えを手放す**＝外で消されたとき、開いたままだと
        // **誰も読めない亡霊へ書き続ける**（次の書き込みで作り直す）。
        close_open_file();
        return;
    };
    if meta.len() < max_bytes {
        return;
    }
    // ⚠️ **退避の前に手放す**＝**開いた手は付け替えた先へ付いていく**（実測で確かめた＝Rust の
    // ファイルは Windows でも共有指定で開くので `rename` は成功し、そのあとの書き込みは
    // **`stario.1.log` の側へ入る**）。手放さないと、退避を起こした1件が**古い世代へ紛れ**、
    // 次の退避で消える。「名前を付け替えられない」ではない（そう書いていたが違った）。
    close_open_file();
    let old = path.with_file_name("stario.1.log");
    let _ = fs::remove_file(&old);
    let _ = fs::rename(path, &old);
}

/// `YYYY-MM-DD HH:MM:SS`（現地時刻ではなく UTC からの経過秒で作る＝時計の設定に依らない）。
///
/// ⚠️ **外部の日付クレートを足さない**＝この1か所のためだけに依存を増やさない。
/// 秒までの粗い刻みで足りる（**どの試行か**が分かればよい）。
fn now_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = civil_from_days(days as i64);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{m:02}:{s:02}Z")
}

/// 1970-01-01 からの日数を年月日へ（Howard Hinnant の civil_from_days）。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 技術詳細を1行残す（`eprintln!` と同じ書式で書ける）。
///
/// ⚠️ **`eprintln!` を直に使わない**＝配布版では stderr がどこにも残らないので、**書いた本人しか読めない**
/// 記録になる。ここを通せば、そのまま `appData/logs` にも残る（dev のコンソールにも従来どおり出る）。
#[macro_export]
macro_rules! tlog {
    ($tag:expr, $($arg:tt)*) => {
        $crate::trouble_log::record($tag, &format!($($arg)*))
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 同時に書いても行が落ちない（#957 レビュー）。
    ///
    /// ⚠️ **この記録の存在意義は「複数箇所が同時にこけたときの調査材料」**なので、まさにその場面で
    /// 消えるのがいちばん困る。`rotate_if_needed` の**サイズ確認→削除→リネーム**は分けて書くと
    /// 競合するので、書き込みまでをひとまとまりにしてある。
    /// ⚠️ **上限を跨がせる**＝退避が起きる状況で試さないと、競合そのものを踏まない。
    #[test]
    fn record_keeps_every_line_under_concurrency() {
        let _serial = probe::SERIAL.lock(); // process にひとつの錠を共有するので並ばせる
        use std::sync::Barrier;
        let dir = std::env::temp_dir().join("stario_tlog_concurrency");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        // ⚠️ **上限を小さくして退避を何度も起こす**＝1回しか退避しないと競合そのものを踏まない。
        const SMALL_MAX: u64 = 1; // ⚠️ **毎回退避させる**＝退避の競合を確実に踏ませる（緩いと race を踏まずに緑になる）

        probe::MAX.store(0, std::sync::atomic::Ordering::SeqCst);
        const THREADS: usize = 8;
        const EACH: usize = 60;
        let barrier = std::sync::Arc::new(Barrier::new(THREADS));
        let hs: Vec<_> = (0..THREADS)
            .map(|t| {
                let b = barrier.clone();
                let d = dir.clone();
                std::thread::spawn(move || {
                    b.wait(); // いっせいに書き始める＝競合を起こしにくくしない
                    for i in 0..EACH {
                        record_to(&d, "t", &format!("line-{t}-{i}"), SMALL_MAX);
                    }
                })
            })
            .collect();
        for h in hs {
            h.join().unwrap();
        }

        // ⚠️ **「全部残っている」は言えない**＝退避は1世代しか持たないので、捨てられるのが正しい。
        // 競合したときに実際に壊れるのは次の2つなので、そこを見る。
        // (1) **行が混ざる**＝別の書き込みが1行の途中に刺さる。
        // (2) **退避が効かなくなる**＝Windows では他のスレッドが開いている間の rename は失敗し、
        //     `let _ =` で握られるので**上限を超えて太り続ける**（気づけないまま記録が肥大する）。
        let mut lines: Vec<String> = Vec::new();
        for name in ["stario.1.log", "stario.log"] {
            for l in fs::read_to_string(dir.join(name))
                .unwrap_or_default()
                .lines()
            {
                lines.push(l.to_string());
            }
        }
        assert!(!lines.is_empty(), "1行も残っていない");
        for l in &lines {
            // 形は「時刻・[札]・line-<t>-<i>」の1件ぶんだけ。混線すると `line-` が2つ以上出る。
            assert_eq!(l.matches("line-").count(), 1, "行が混ざった: {l}");
            assert_eq!(l.matches('[').count(), 1, "行が混ざった: {l}");
        }
        // 退避が実際に起きた＝競合する経路を通した（通っていないテストで安心しない）。
        assert!(
            dir.join("stario.1.log").exists(),
            "退避が一度も起きていない＝競合を踏んでいない"
        );
        // ⚠️ **守りたい性質そのものを見る**＝「確認→退避→書き込み」に同時に2本入らないこと。
        // ファイルの最後の状態で見ると、毎回退避する設定では最後の1本が書き直して**勝手に整う**ため、
        // 錠を外しても緑のままだった（実際に確かめて分かった）。
        let max = probe::MAX.load(std::sync::atomic::Ordering::SeqCst);
        assert_eq!(
            max, 1,
            "同時に {max} 本が退避と書き込みの中に居た＝ひとまとまりになっていない"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 札に改行が混じっても1行のまま（#957 レビュー）。
    /// ⚠️ **`one_line` を直接見ない**＝それだと `record` が札へ通していなくても緑になる（実際そうだった）。
    /// 中身の改行も1行に潰れる（α-7 出口監査 🟡）。
    ///
    /// ⚠️ **`one_line` を直接見るだけでは足りない**＝`record_to` がそれを通していなくても緑になる。
    /// FFmpeg の出力は複数行で来るので、**この機能の主な使い道**がまさにここ。
    #[test]
    fn record_flattens_detail_too() {
        let _serial = probe::SERIAL.lock(); // process にひとつの錠を共有するので並ばせる
        use super::record_to;
        use std::fs;
        let dir = std::env::temp_dir().join("stario_tlog_detail");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        record_to(
            &dir,
            "t",
            "1行目
2行目
3行目",
            MAX_BYTES,
        );
        let body = fs::read_to_string(dir.join("stario.log")).unwrap();
        assert_eq!(body.lines().count(), 1, "中身の改行で行が割れた: {body:?}");
        assert!(
            body.contains("1行目 / 2行目 / 3行目"),
            "潰れていない: {body:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn record_flattens_tag_too() {
        let _serial = probe::SERIAL.lock(); // process にひとつの錠を共有するので並ばせる
        let dir = std::env::temp_dir().join("stario_tlog_tag");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        record_to(&dir, "ui\nwarn", "detail", MAX_BYTES);
        let body = fs::read_to_string(dir.join("stario.log")).unwrap();
        assert_eq!(body.lines().count(), 1, "札の改行で行が割れた: {body:?}");
        assert!(body.contains("[ui / warn]"), "札が潰れていない: {body:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// 日付の変換（`civil_from_days`）。
    /// ⚠️ **外部の日付クレートを入れない代わりに、ここで固定する**＝閏年と月末の境目で1日ずれると、
    /// 記録の日付が黙って間違う（読む側は気づけない）。
    #[test]
    fn 日付の変換が合っている() {
        assert_eq!(civil_from_days(0), (1970, 1, 1)); // 起点
        assert_eq!(civil_from_days(59), (1970, 3, 1)); // 平年の2月は28日
        assert_eq!(civil_from_days(19_723), (2024, 1, 1)); // 閏年の初日
        assert_eq!(civil_from_days(19_782), (2024, 2, 29)); // 閏日そのもの
        assert_eq!(civil_from_days(19_783), (2024, 3, 1)); // その翌日
    }

    /// 1件が1行になる（複数行の出力を潰す）。
    /// ⚠️ **FFmpeg の出力は複数行で来る**ので、そのまま書くと1件が何行にもなり、
    /// あとから「どこからどこまでが1回の失敗か」が読めない。
    #[test]
    fn 複数行は一行に潰れる() {
        // ⚠️ **実装（`one_line`）を通す**＝テストの中で同じ式を書き直すと、実装を変えても落ちない。
        let one = one_line("line1\nline2\r\nline3");
        assert_eq!(one, "line1 / line2 / line3");
        assert!(!one.contains('\n'));
    }

    /// 置き場が決まっていなくても落ちない（ブラウザ開発・書き込めない環境）。
    /// ⚠️ **記録できないことでアプリを止めない**＝失敗の記録は「あると助かる」もので、
    /// 無いことが動作不能の理由にはならない。
    #[test]
    fn 置き場が無くても落ちない() {
        // `LOG_DIR` はこのテストでは未設定（`init` を呼ばない）。
        record("test", "置き場が無いときに呼ばれても panic しない");
    }

    /// 上限を超えていなければ退避しない／超えたら1世代だけ退避する。
    #[test]
    fn 大きくなったら一世代だけ退避する() {
        let _serial = probe::SERIAL.lock(); // process にひとつの錠を共有するので並ばせる
        let dir = std::env::temp_dir().join(format!("stario_log_test_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("stario.log");
        let old = dir.join("stario.1.log");

        // 小さいうちは動かさない。
        fs::write(&path, b"small").unwrap();
        rotate_if_needed(&path, MAX_BYTES);
        assert!(path.exists(), "小さいうちは退避しない");
        assert!(!old.exists());

        // 上限を超えたら退避する。
        fs::write(&path, vec![b'x'; (MAX_BYTES + 1) as usize]).unwrap();
        rotate_if_needed(&path, MAX_BYTES);
        assert!(!path.exists(), "退避したので元の名前は消える");
        assert!(old.exists(), "1世代目へ移る");

        // もう一度あふれても、増えるのは1世代まで。
        fs::write(&path, vec![b'y'; (MAX_BYTES + 1) as usize]).unwrap();
        rotate_if_needed(&path, MAX_BYTES);
        assert!(old.exists());
        assert_eq!(fs::read(&old).unwrap()[0], b'y', "古い方は上書きされる");
        assert!(!dir.join("stario.2.log").exists(), "2世代目は作らない");

        let _ = fs::remove_dir_all(&dir);
    }

    /// **退避を起こした1件が、古い世代へ紛れないこと**（#958）。
    ///
    /// ⚠️ **開いた手は付け替えた先へ付いていく**（実測）＝`rename` は成功するので
    /// 「退避できない」形では現れない。現れ方は**退避を起こした1件が `stario.1.log` の側へ入る**で、
    /// それは**次の退避で消える**。直接 `rotate_if_needed` を呼ぶ既存のテストでは、
    /// **手を掴んでいない**ので踏めない。
    #[test]
    fn 退避を起こした一件は新しい方へ書かれる() {
        let _serial = probe::SERIAL.lock();
        let dir = std::env::temp_dir().join(format!("stario_log_rot_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        close_open_file();

        const SMALL: u64 = 300;
        let path = dir.join("stario.log");
        let old = dir.join("stario.1.log");
        let mut trigger = None;
        for i in 0..8 {
            let mark = format!("mark-{i}");
            record_to(&dir, "t", &format!("{mark} {}", "x".repeat(200)), SMALL);
            if old.exists() {
                trigger = Some(mark); // この1件が退避を起こした
                break;
            }
        }

        let now = fs::read_to_string(&path).unwrap_or_default();
        let rotated = fs::read_to_string(&old).unwrap_or_default();
        let _ = fs::remove_dir_all(&dir);
        close_open_file();

        let mark = trigger.expect("上限を超えたのに退避が起きていない");
        assert!(
            now.contains(&mark),
            "退避を起こした {mark} が新しい方に無い"
        );
        assert!(
            !rotated.contains(&mark),
            "退避を起こした {mark} が古い世代へ紛れた"
        );
    }

    /// **外で消されても、次の1件から書き直せること**（#958）。
    ///
    /// ⚠️ 開いた手を持ち続けるので、**ファイルだけ外で消される**（掃除・検疫）と
    /// **誰も読めない亡霊へ書き続ける**＝記録は「うまくいかないとき」に読むものなので、
    /// 静かに何も残らないのがいちばん困る。
    #[test]
    fn 外で消されても次から書き直す() {
        let _serial = probe::SERIAL.lock();
        let dir = std::env::temp_dir().join(format!("stario_log_del_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        close_open_file();

        record_to(&dir, "t", "まえ", MAX_BYTES);
        let path = dir.join("stario.log");
        assert!(path.exists());
        fs::remove_file(&path).unwrap(); // 外で消される

        record_to(&dir, "t", "あと", MAX_BYTES);
        let after = fs::read_to_string(&path).unwrap_or_default();
        let _ = fs::remove_dir_all(&dir);
        close_open_file();

        assert!(
            after.contains("あと"),
            "消された後の1件がどこにも残っていない"
        );
    }

    /// **記録を1件ごとに開き直していないこと**（α-7 出口監査の未対応項目・#958）。
    ///
    /// ⚠️ **数字を出さずに「引っかかる／引っかからない」を決めない**＝監査は
    /// 「1件ごとに同期で書くので、警告が続く場面での引っかかりは実測が要る」と保留していた。
    /// 実測（最適化した単体の計測・Windows）＝**開くのに 13.8ms・書くのは 6us**＝
    /// **ほぼ全部が開き直しの代金**だった。書き出しの警告は続けて来るので、そのぶん画面が固まる。
    ///
    /// ⚠️ **時間そのものは検査にしない**＝機械と同時に走っているものに左右される
    /// （このテスト自体、並行だと 15490us/件・単独だと 358us/件という別の数字が出た）。
    /// 効いているかどうかは**開いた回数**で見る＝これは機械に依らない。
    #[test]
    fn 記録は一件ごとに開き直さない() {
        let _serial = probe::SERIAL.lock();
        let dir = std::env::temp_dir().join(format!("stario_log_open_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        // 開いたままだと退避できないので、**置き場を変えて**必ず1回目から開かせる。
        close_open_file();

        // ⚠️ **上限は本番と同じ**＝小さくすると退避が何度も起きて、そのたび開き直すのが正しい挙動になる。
        const N: u32 = 50;
        let detail = "ffmpeg
frame= 100 fps=30
error: "
            .to_string()
            + &"x".repeat(400);

        probe::OPENS.store(0, std::sync::atomic::Ordering::SeqCst);
        let start = std::time::Instant::now();
        for i in 0..N {
            record_to(&dir, "export", &format!("{i} {detail}"), MAX_BYTES);
        }
        let each_us = start.elapsed().as_micros() / u128::from(N);
        let opens = probe::OPENS.load(std::sync::atomic::Ordering::SeqCst);

        let path = dir.join("stario.log");
        let written = fs::read_to_string(&path).unwrap();
        assert_eq!(written.lines().count(), N as usize, "全部書けている");
        let _ = fs::remove_dir_all(&dir);
        close_open_file(); // 消した置き場を掴んだままにしない

        eprintln!("[measure] {N}件で {opens}回開いた・1件あたり {each_us}us");
        assert_eq!(
            opens, 1,
            "{N}件で {opens}回開いた（1回のはず＝開き直している）"
        );
    }
}
