// メモリの様子（ADR-0070）。書き出しのコマを別の窓でも描くとき、窓をいくつ足すかを決めるのに使う。
//
// ⚠️ **答えるだけ**＝いくつ足すかの判定は画面側（`domain/export/renderWindowPlan.ts`）。
// ⚠️ **調べられなければ `None`**＝0 を返すと「空きが無い」と読まれる。画面は `None` なら窓を足さない（いままでどおり1窓）。
// ⚠️ **「いま空いている物理メモリ」だけでは決めない**（ADR-0070 追補 2026-11-04）＝Windows は使われていないメモリを
//   退かせて場所を作るので、空きが少なく見えても窓を足した方が速かった（実測）。判定には**積んでいるメモリ**と
//   **まだ確保できる余地（ページファイル込み）**を使う。いまの空きは記録のために返す。

/// メモリの様子（バイト）。
#[derive(serde::Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStatus {
    /// 積んでいる物理メモリ。
    pub total_phys: u64,
    /// いま空いている物理メモリ（記録用）。
    pub avail_phys: u64,
    /// まだ確保できる余地（ページファイル込みの上限までの残り）。尽きると確保に失敗する。
    pub avail_commit: u64,
}

/// いまのメモリの様子。
#[cfg(windows)]
pub fn memory_status_now() -> Option<MemoryStatus> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY: 構造体は 0 で初期化し、大きさ（dwLength）を入れてから渡す（API の決まり）。書き込み先は自分のスタック。
    let mut st: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    st.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    let ok = unsafe { GlobalMemoryStatusEx(&mut st) };
    if ok == 0 {
        return None;
    }
    Some(MemoryStatus {
        total_phys: st.ullTotalPhys,
        avail_phys: st.ullAvailPhys,
        avail_commit: st.ullAvailPageFile,
    })
}

#[cfg(not(windows))]
pub fn memory_status_now() -> Option<MemoryStatus> {
    None
}

/// 画面へ返す口（ADR-0070）。
#[tauri::command]
pub fn memory_status() -> Option<MemoryStatus> {
    memory_status_now()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn メモリの様子が取れる() {
        let m = memory_status_now().expect("取れる");
        assert!(m.total_phys > 0);
        assert!(m.avail_phys <= m.total_phys);
        assert!(m.avail_commit > 0);
    }
}
