# α から写したもの（ADR-0075 決定2）

すたりおMV（γ）は、当面 α（すたりお）の部品を**参照**するか**小さく写して**使う。
写したものはここに並べる＝**どれが写しかを追えるようにする**（本格的な切り出しのとき、ここが二重管理の一覧になる）。

| γ のファイル | 写し元（α） | 写した日 | 変えたこと |
|---|---|---|---|
| `src-tauri/icons/32x32.png`・`128x128.png`・`128x128@2x.png`・`icon.icns`・`icon.ico` | `src-tauri/icons/` の同名 | 2026-11-26 | なし（γ の図柄が決まったら差し替える） |

## 参照しているもの（写していない）

| γ の設定 | 指している先（α） |
|---|---|
| `src-tauri/tauri.conf.json` の `bundle.resources` | `src-tauri/resources/ffmpeg`・`src-tauri/resources/transcribe`（VOICEVOX と同梱 AI は指さない＝ADR-0074 決定1） |
| `crates/mv-render` の検査（文字） | `public/fonts`（Gen Interface JP など・SIL OFL 1.1＝MV-0003 決定5） |
