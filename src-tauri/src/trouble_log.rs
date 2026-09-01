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
use std::sync::OnceLock;

/// 記録の置き場（`appData/logs`）。**起動時に一度だけ**決める。
///
/// ⚠️ **`AppHandle` を持ち回らない**＝技術詳細を出す所は 68 か所以上あり、そこへ引数を足して回ると
/// 差分が広がるうえ、**足し忘れた所だけ記録が残らない**（片方だけ直す型）。process 全体で1つ持つ。
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

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
    let path = dir.join("stario.log");
    rotate_if_needed(&path);
    let one = one_line(detail);
    let line = format!("{}\t[{}]\t{}\n", now_stamp(), tag, one);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
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

/// 上限を超えていたら1世代だけ退避する（`stario.log` → `stario.1.log`）。
fn rotate_if_needed(path: &PathBuf) {
    let Ok(meta) = fs::metadata(path) else { return };
    if meta.len() < MAX_BYTES {
        return;
    }
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
        let dir = std::env::temp_dir().join(format!("stario_log_test_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("stario.log");
        let old = dir.join("stario.1.log");

        // 小さいうちは動かさない。
        fs::write(&path, b"small").unwrap();
        rotate_if_needed(&path);
        assert!(path.exists(), "小さいうちは退避しない");
        assert!(!old.exists());

        // 上限を超えたら退避する。
        fs::write(&path, vec![b'x'; (MAX_BYTES + 1) as usize]).unwrap();
        rotate_if_needed(&path);
        assert!(!path.exists(), "退避したので元の名前は消える");
        assert!(old.exists(), "1世代目へ移る");

        // もう一度あふれても、増えるのは1世代まで。
        fs::write(&path, vec![b'y'; (MAX_BYTES + 1) as usize]).unwrap();
        rotate_if_needed(&path);
        assert!(old.exists());
        assert_eq!(fs::read(&old).unwrap()[0], b'y', "古い方は上書きされる");
        assert!(!dir.join("stario.2.log").exists(), "2世代目は作らない");

        let _ = fs::remove_dir_all(&dir);
    }
}
