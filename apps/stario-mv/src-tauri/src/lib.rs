//! すたりおMV（γ）の本体。⚠️ **まだ骨組みだけ**（#1337 §15 ④）＝窓を出すだけ。中身は γ0.1 から（ADR-0074 決定6）。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("すたりおMV を起動できませんでした");
}
