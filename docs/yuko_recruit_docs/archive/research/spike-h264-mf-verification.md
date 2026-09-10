# スパイク：Media Foundation（h264_mf）実機検証手順

- **種別**: 使い捨てスパイク（製品実装ではない）。合格後に正式実装へ整理し直す。
- **目的**: 案A（FFmpeg＋`h264_mf`）が本ソフトの書き出し用途で実用かを、**Windows実機**で判定する。
- **前提コード**: `src-tauri/src/ffmpeg.rs` に **スパイク変更を投入済み**＝`pick_codec` が `h264_mf` を最優先で検出（`VideoCodec::MediaFoundation` → エンコーダ名 `h264_mf`）。現行の開発用 ffmpeg-static は `h264_mf` を持たないため、この変更だけでは既存挙動は変わらない（`h264_mf` を持つ FFmpeg を置いたときのみ MF が選ばれる）。
- **関連**: [`export-encoder-mediafoundation-vs-openh264.md`](export-encoder-mediafoundation-vs-openh264.md) §4・§7・§8。

> 実行はすべて PowerShell 想定。`<...>` は各自のパスに置換。

---

## 0. h264_mf を持つ FFmpeg を用意（検証専用）

- 検証では **`h264_mf` を含む Windows ビルドなら何でも可**（例：gyan.dev essentials は構成に `mediafoundation` を含む）。
  - 注意：gyan ビルドは GPL（libx264 等を含む）。**配布には使わない**＝あくまで検証用。配布版の LGPL ビルドは合格後に別途用意する。
- 任意のフォルダに展開し、`ffmpeg.exe` のフルパスを控える（例：`C:\tools\ffmpeg\bin\ffmpeg.exe`）。

### 0.1 h264_mf の存在確認（最初の関門）
```powershell
& "C:\tools\ffmpeg\bin\ffmpeg.exe" -hide_banner -encoders | Select-String "h264_mf"
```
- **出れば** → 次へ。
- **出ない** → この端末では MF の H.264 が使えない。**Windows N / KN（Media Feature Pack 未導入）の可能性**（資料 §4.5）。`設定 → アプリ → オプション機能` で「メディア機能パック」を確認。N/KN 比率が高いなら案A単独はリスク（案Cフォールバックの要否に直結）。

---

## Phase 1：エンコーダ単体の健全性（アプリ再ビルド不要・最速）

テスト映像＋音声を生成して `h264_mf` で書き出し、再生・PowerPoint挿入まで確認する。

### 1-A 横型 1920×1080・30秒（yuv420p）
```powershell
& "C:\tools\ffmpeg\bin\ffmpeg.exe" -f lavfi -i testsrc2=size=1920x1080:rate=30 `
  -f lavfi -i sine=frequency=440:sample_rate=44100 `
  -c:v h264_mf -pix_fmt yuv420p -c:a aac -ar 44100 -ac 2 -t 30 `
  "$env:USERPROFILE\Downloads\spike_h_1080p_30s_yuv420p.mp4"
```

### 1-B 縦型 1080×1920・10分（yuv420p）※縦型は実ピクセルで出るかをここで確認
```powershell
& "C:\tools\ffmpeg\bin\ffmpeg.exe" -f lavfi -i testsrc2=size=1080x1920:rate=30 `
  -f lavfi -i sine=frequency=440:sample_rate=44100 `
  -c:v h264_mf -pix_fmt yuv420p -c:a aac -ar 44100 -ac 2 -t 600 `
  "$env:USERPROFILE\Downloads\spike_v_1080x1920_10min.mp4"
```

### 1-C nv12 フォールバック確認（yuv420p で不調なら）
```powershell
& "C:\tools\ffmpeg\bin\ffmpeg.exe" -f lavfi -i testsrc2=size=1920x1080:rate=30 `
  -f lavfi -i sine=frequency=440:sample_rate=44100 `
  -c:v h264_mf -pix_fmt nv12 -c:a aac -ar 44100 -ac 2 -t 30 `
  "$env:USERPROFILE\Downloads\spike_h_1080p_30s_nv12.mp4"
```

### 1-D 検証（各 mp4 について）
```powershell
& "C:\tools\ffmpeg\bin\ffprobe.exe" -hide_banner "<出力mp4>"
```
- **解像度・コーデック(h264)・音声(aac)・尺**が指定どおりか。**縦型は width=1080 / height=1920**（回転メタデータでなく実ピクセル）であることを確認。
- Windows標準プレーヤー（映画 & テレビ等）で再生できるか。
- **PowerPoint に「挿入 → ビデオ → このデバイス」で挿入し再生**できるか。

---

## Phase 1b：本パイプライン相当（PNG静止画＋音声）

本ソフトの `scene_clip_args` に近い「PNG を `-loop 1` で動画化」を直接試す。任意の 1920×1080 PNG（または下のコマンドで生成）を使う。
```powershell
# テストPNG生成（1080p）
& "C:\tools\ffmpeg\bin\ffmpeg.exe" -f lavfi -i testsrc2=size=1920x1080 -frames:v 1 "$env:TEMP\spike_frame.png"
# PNG → h264_mf（音声は無音トラック）
& "C:\tools\ffmpeg\bin\ffmpeg.exe" -loop 1 -i "$env:TEMP\spike_frame.png" `
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 `
  -r 30 -pix_fmt yuv420p -c:v h264_mf -c:a aac -ar 44100 -ac 2 -t 10 `
  "$env:USERPROFILE\Downloads\spike_png_h264mf.mp4"
```
- ffprobe / 再生で確認（Phase 1-D と同様）。

---

## Phase 2：アプリの実パイプライン（合成・トランジション・BGM込み）

スパイク変更入りのアプリで、実際の書き出し経路を通す。

1. 環境変数で検証用 FFmpeg を指す（`resolve_ffmpeg` は `FFMPEG_PATH` を最優先）。
   ```powershell
   $env:FFMPEG_PATH = "C:\tools\ffmpeg\bin\ffmpeg.exe"
   ```
2. その PowerShell から開発起動（または同変数を設定して起動）。
   ```powershell
   npm run tauri dev
   ```
3. 既存プロジェクト（場面・ナレーション・BGM・素材動画あり）で **「動画を出力」**。
4. 出力 mp4 を ffprobe・再生・PowerPoint挿入で確認。`codec` が `h264_mf` 経由になっているか（書き出し成功＝MFが選択されている）。
   - **30秒尺**と**約10分尺**の両方で所要時間・ファイルサイズを記録。
   - 注：**縦型はアプリUIが未対応**（16:9固定）。縦型の実ピクセル確認は Phase 1-B（生コマンド）で実施。アプリ経由の縦型は別トラック（縦型対応 ADR）完了後。

---

## 比較（libx264 スパイクと）

同じ素材・同じ尺で、現行の libx264（`h264_mf` を持たない ffmpeg-static）でも書き出し、**所要時間・ファイルサイズ・体感画質**を比較する。h264_mf が極端に遅い/大きい/低画質でないことを確認。

---

## 報告してほしい結果（このまま埋めて返信で可）

| 項目 | 結果 |
|---|---|
| `-encoders` に `h264_mf` | 出た / 出ない（出ない場合：Windowsエディション＝ ） |
| 1-A 横1080p/30s（yuv420p） | 成功/失敗・再生OK?・PowerPoint OK? |
| 1-B 縦1080×1920/10分 | 成功/失敗・ffprobeのwidth×height＝ ・再生OK? |
| 1-C nv12 | 試した?・1-Aと差は? |
| 1b PNG→h264_mf | 成功/失敗 |
| Phase2 アプリ書き出し30s | 成功/失敗・所要 ＿秒・サイズ ＿MB |
| Phase2 アプリ書き出し10分 | 成功/失敗・所要 ＿秒・サイズ ＿MB |
| libx264比較（同条件） | 時間/サイズ/画質の差 |
| エラー文・気づき | （あれば） |

---

## 合否判定（資料 §7 の採用条件）
- 横/縦・30秒/10分すべてで mp4 生成＋ffprobe整合＋標準プレーヤー/PowerPoint再生 → **採用条件②クリア**。
- 画質・速度・サイズが採用動画用途で実用域（libx264比較で許容内）→ **採用条件③クリア**。
- `h264_mf` が `-encoders` に出る（Windows N可用性に見通し）→ **採用条件①クリア**。
- すべてクリアなら案Aを正式採用へ。いずれか不可なら案C（OpenH264）フォールバックの要否を判断。

## スパイク後の後始末
- 合格：`pick_codec` の h264_mf 最優先化を正式実装として整理（優先順位の定数化・テスト維持・`05_RENDERING_SPEC`/`adr/0002` 追補）。
- 不合格：`ffmpeg.rs` のスパイク変更（`VideoCodec::MediaFoundation` と `h264_mf` 検出）を revert し、案Cを継続。

---

## 実機検証の結果（2026-06-18）

ユーザーが Windows 実機で Step 1〜7 を実施。

### 機能面：全成功
- 使用 FFmpeg＝gyan **release essentials（GPL, FFmpeg 8.1.1）**。構成に `--enable-mediafoundation` ＋ HW エンコーダ（`nvenc`/`amf`/`libvpl(QSV)`）も同梱。`-encoders` に `h264_mf` あり。
- 横 1920×1080・縦 1080×1920（実ピクセル）・30秒・10分・PNG入力・**アプリの実パイプライン（Step 7）まで含めエラーなし**。
- → 機能的には案Aは Windows 実機で通る（採用条件②は実機で確認できた）。

### 品質面：当初「悪すぎる」→ 原因はビットレート未指定（解決）
- 最初の出力は画質が実用外だった。**原因＝本ソフトの FFmpeg 引数が目標ビットレートを一切指定していない**こと（`scene_clip_args` 等が `-b:v` を出さない）。
  - libx264 は無指定でも CRF 23 既定で良好に出る。h264_mf は無指定だと既定ビットレートが低く画質が崩れる（＝不公平な既定差）。
- 実機比較で **`h264_mf -b:v 12M` が `libx264 -crf 23` とほぼ同等画質**であることを確認（`testsrc` の最悪パターンで同等＝静止スライドならさらに良好）。

### 適用した修正（スパイク）
- `ffmpeg.rs` に `VideoCodec::quality_args()` を追加。**MediaFoundation のときだけ `-b:v 12M`**（`MF_TARGET_BITRATE`）を付与。x264/OpenH264 は無指定（従来どおり）。
- 3つのエンコード箇所（`scene_clip_args` / 動画シーン / `xfade` 再エンコード）の `-c:v <encoder>` 直後に挿入。専用テスト追加・`cargo test` 緑。x264/OpenH264 経路は出力不変（quality_args が空）。

### 残課題（2026-06-18 更新）
1. ~~アプリ実コンテンツでの最終確認~~ → **完了**：MF＋12M でアプリ実書き出しが良好画質と確認（ユーザー Windows・`06181555.mp4`）。
2. ~~配布用 LGPL ビルドでの h264_mf 実搭載~~ → **完了**：BtbN `win64-lgpl`（static）で `--disable-libx264/x265`＋`h264_mf`（H264 via MediaFoundation）実在を実機確認＝**自前ビルド不要**。同ビルドは openh264(BSD) も静的同梱するが pick_codec が h264_mf 優先で未使用。
3. **ファイルサイズの最適化**：固定 12M は 1080p で十分だが 10分で約900MB と大きめ。解像度別ビットレート or 品質ベース RC は後続課題（`-b:v` は実機確認済みの確実な手段なので暫定採用）。
4. **Windows N/KN**：対象端末群に N/KN がある場合の `h264_mf` 可用性（Media Feature Pack）。
5. **配布形態**：LGPL は `win64-lgpl-shared`（動的リンク）＋ソース提供が素直（ADR-0002）。使用バージョンの pin。
