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

/// 起こした子を**このアプリと一緒に終わらせる**（負荷試験 2026-10-22）。
///
/// ⚠️ **異常終了でも残さない**＝子を止めるのは `RunEvent::ExitRequested` のときだけだったので、アプリが落ちた・
/// タスクマネージャーで終了したときは VOICEVOX ENGINE（約 485MB）や同梱の AI（数 GB）が**残り続け**、次に起動すると
/// もう1つ起こしていた（実機で2つ並んだのを確かめた）。Windows のジョブ（`KILL_ON_JOB_CLOSE`）に入れておくと、
/// アプリのプロセスが消えてジョブの最後の握りが閉じた時点で、OS が子を終わらせる。
///
/// ⚠️ **アプリそのものはジョブに入れない**＝入れると、アプリが開いた**利用者のアプリ**（書き出した動画を開いた再生ソフトなど）
/// まで、アプリを閉じたときに終わってしまう。ここで名指しした子だけを入れる。
/// 入れられなかったとき（古い Windows・別のジョブの決まり）は何もしない＝今までどおり終了の合図で止める。
#[cfg(windows)]
pub fn bind_to_app_lifetime(child: &std::process::Child) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
    let job = app_job();
    if job == 0 {
        return;
    }
    unsafe {
        let assigned = AssignProcessToJobObject(job as _, child.as_raw_handle() as _);
        if assigned == 0 {
            crate::tlog!(
                "proc",
                "子をアプリの寿命に結べませんでした（終了の合図で止めます）"
            );
        }
    }
}

/// アプリで1つのジョブ（`KILL_ON_JOB_CLOSE`）の握り。作れなかったら 0。
/// 握りはアプリが終わるまで閉じない（閉じた時点で子が終わる＝それが狙い）。
#[cfg(windows)]
fn app_job() -> usize {
    use std::sync::OnceLock;
    use windows_sys::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    static JOB: OnceLock<usize> = OnceLock::new();
    *JOB.get_or_init(|| unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return 0;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            return 0;
        }
        job as usize
    })
}

#[cfg(not(windows))]
pub fn bind_to_app_lifetime(_child: &std::process::Child) {}

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

    /// 結んだ子は**アプリのジョブに入っている**（異常終了で OS が終わらせる）。
    /// ⚠️ 「アプリが落ちたら子が消える」そのものは検査の中では起こせない＝実機で確かめた（PR 本文）。
    /// ⚠️ **アプリのジョブを名指しして**聞く＝検査を走らせる側が元から別のジョブの中にいると、
    ///   「どれかのジョブに入っているか」は結ぶ前から真になり、結ばなくても通ってしまう（変異チェックで露見）。
    #[cfg(windows)]
    #[test]
    fn bound_child_is_in_the_app_job() {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::IsProcessInJob;
        let mut child = no_window_command("cmd")
            .args(["/C", "ping -n 3 127.0.0.1 > NUL"])
            .spawn()
            .unwrap();
        let job = app_job();
        assert_ne!(job, 0, "ジョブを作れていない");
        let in_app_job = |c: &std::process::Child| {
            let mut r = 0;
            unsafe { IsProcessInJob(c.as_raw_handle() as _, job as _, &mut r) };
            r != 0
        };
        assert!(!in_app_job(&child), "結ぶ前からアプリのジョブに入っている");
        bind_to_app_lifetime(&child);
        assert!(in_app_job(&child), "結んだ子がアプリのジョブに入っていない");
        let _ = child.kill();
        let _ = child.wait();
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
