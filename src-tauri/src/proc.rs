// 外部プログラム（ffmpeg・VOICEVOX ENGINE）の**起こし方**を1か所に集める（#1107）。
//
// ⚠️ **黒い窓は「起こし方」の問題**＝このアプリは GUI（`windows_subsystem = "windows"`）なので
// 継承するコンソールが無く、コンソール向けの実行ファイルを素で起こすと**新しい窓が開いて消える**。
// 書き出しは場面ごとのエンコードに加えて結合・字幕・BGM でも起こすので、そのぶん何度もちらつく。
//
// ⚠️ **各所に1行ずつ書き足さない**＝以前 VOICEVOX にだけ入れて ffmpeg の4か所が漏れていた
// （`git log -S "creation_flags"` に出るのは VOICEVOX の1件だけだった）。同じ規則は入口を1つにして、
// 直に起こしていないことを門番（`src/test/noWindowSpawnGuard.test.ts`）が見る。
//
// ⚠️ **根拠の射程**＝`CLAUDE.md` §2-7（数値を直書きしない）が効くのは**値**（`CREATE_NO_WINDOW` を
// 1か所に置いた点）だけで、**入口を1つにすること自体**は §4（外部I/O は infrastructure に隔離する）の側。
use std::ffi::OsStr;
use std::process::Command;

/// 新しいコンソール窓を開かせない Windows のフラグ（`CREATE_NO_WINDOW`）。
///
/// ⚠️ **この値の置き場はここだけ**＝以前は `voicevox_engine.rs` の中に直書きしていた。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 外部プログラムを**コンソール窓を出さずに**起こすための `Command` を作る。
///
/// Windows 以外では素の `Command` と同じ（このフラグは Windows 専用）。
pub fn no_window_command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    hide_console(&mut cmd);
    cmd
}

#[cfg(windows)]
fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_cmd: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;

    /// ⚠️ **フラグそのものは読み出せない**（`Command` に取り出す API が無い）＝
    /// ここで見られるのは「入口が同じプログラムを起こす `Command` を返す」ことまで。
    /// **フラグが載っているか**は `src/test/noWindowSpawnGuard.test.ts` が
    /// 入口の中身（`creation_flags`）を見て留め、消えたことは実機で分かる。
    #[test]
    fn no_window_command_keeps_the_program() {
        let cmd = no_window_command("ffmpeg");
        assert_eq!(cmd.get_program(), "ffmpeg");
    }

    /// 引数を足しても入口の戻り値がそのまま組み立てに使えること（呼び出し側は連ねて書く）。
    #[test]
    fn no_window_command_is_chainable() {
        let mut cmd = no_window_command("ffmpeg");
        cmd.arg("-hide_banner");
        let args: Vec<_> = cmd.get_args().collect();
        assert_eq!(args, ["-hide_banner"]);
    }
}
