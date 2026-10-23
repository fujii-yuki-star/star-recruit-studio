// 空いているメモリ（ADR-0070）。書き出しのコマを別の窓でも描くとき、窓をいくつ足すかを決めるのに使う。
//
// ⚠️ **答えるだけ**＝いくつ足すかの判定は画面側（`renderer/export/parallelPlan.ts`）。
// ⚠️ **調べられなければ `None`**＝0 を返すと「空きが無い」と読まれる。画面は `None` なら窓を足さない（いままでどおり1窓）。

/// いま空いている物理メモリ（バイト）。
#[cfg(windows)]
pub fn available_physical_bytes() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY: 構造体は 0 で初期化し、大きさ（dwLength）を入れてから渡す（API の決まり）。書き込み先は自分のスタック。
    let mut st: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    st.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    let ok = unsafe { GlobalMemoryStatusEx(&mut st) };
    if ok == 0 {
        return None;
    }
    Some(st.ullAvailPhys)
}

#[cfg(not(windows))]
pub fn available_physical_bytes() -> Option<u64> {
    None
}

/// 画面へ返す口（ADR-0070）。
#[tauri::command]
pub fn available_memory_bytes() -> Option<u64> {
    available_physical_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn 空いているメモリが取れる() {
        let n = available_physical_bytes().expect("空きが取れる");
        assert!(n > 0);
    }
}
