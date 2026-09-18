// ディスクの空き（#1211）。**書き出しを始める前と、焼いている途中に見る**。
//
// ⚠️ **なぜ要るか**＝コマを1枚ずつ焼く書き出しは、一時ファイルが**数十GB**になる
// （実測＝30分で最大約45GB／このパソコンの空きは38.3GB）。いまは確かめていないので、
// **12分以上待たされてから容量が尽きて失敗**し、しかも**数十GBが残る**（#1205 の調査で実際に踏んだ）。
//
// ⚠️ **必要量は推測しない**＝1コマの大きさは中身で**7倍**変わる（実測 0.12MB〜0.83MB）。
// 見積もりは**その動画自身の焼き上がりを測って**出す（判定は `domain/export/diskPlan.ts`）。
// ここは**空きを答えるだけ**。

use std::path::Path;

/// そのパスのあるドライブの**空き**（バイト）。
///
/// ⚠️ **「利用者が使える空き」を返す**（`GetDiskFreeSpaceExW` の第2引数）＝
/// 割り当て制限（クォータ）が掛かっていると、ドライブ全体の空きより**少ない**。
/// 書き出しが実際に書けるのはこちらなので、こちらで判定する。
///
/// ⚠️ **まだ無いフォルダでも答えられるようにする**＝書き出しの置き場は使う直前に作られる。
/// 実在する**親**まで遡ってから聞く（遡れなければ誤り）。
pub fn free_space_bytes(path: &Path) -> Result<u64, String> {
    let mut probe = path;
    loop {
        if probe.exists() {
            break;
        }
        match probe.parent() {
            Some(p) => probe = p,
            None => return Err("空きを調べる場所が見つかりません".to_string()),
        }
    }
    free_space_of_existing(probe)
}

#[cfg(windows)]
fn free_space_of_existing(dir: &Path) -> Result<u64, String> {
    use std::os::windows::ffi::OsStrExt;
    // ⚠️ **末尾に 0 を足す**＝Windows API は 0 終端の UTF-16 を取る。
    let wide: Vec<u16> = dir
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut free_for_user: u64 = 0;
    // SAFETY: `wide` は 0 終端で、書き込み先は自分のスタック上の変数。
    let ok = unsafe {
        windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_for_user,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(format!(
            "空きを調べられませんでした（{}）",
            std::io::Error::last_os_error()
        ));
    }
    Ok(free_for_user)
}

#[cfg(not(windows))]
fn free_space_of_existing(_dir: &Path) -> Result<u64, String> {
    // ⚠️ **Windows 以外は対象外**（CLAUDE.md §3）＝**0 を返さない**。
    // 0 を返すと「空きが無い」と読まれて**必ず断る**ことになる（§2-5 の行き止まり）。
    Err("この環境では空きを調べられません".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 実在するフォルダの空きが取れる() {
        let n = free_space_bytes(&std::env::temp_dir()).expect("空きが取れる");
        assert!(n > 0, "空きが 0 と返った（0 は「必ず断る」になる）");
    }

    /// ⚠️ **書き出しの置き場は使う直前に作られる**＝無いパスでも親まで遡って答えられること。
    #[test]
    fn まだ無いフォルダでも親まで遡って答える() {
        let missing = std::env::temp_dir()
            .join("stario_no_such_dir_1211")
            .join("deeper");
        let n = free_space_bytes(&missing).expect("親まで遡って答える");
        assert!(n > 0, "遡った先で 0 と返った");
    }
}
