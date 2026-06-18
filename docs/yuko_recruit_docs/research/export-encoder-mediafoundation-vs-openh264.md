# 書き出し方式の技術判断：Media Foundation（h264_mf）vs OpenH264（自前ビルド）

- **種別**: 調査・影響分析・推奨判断（**製品実装は含まない**）
- **日付**: 2026-06-18
- **対象**: H.264/MP4 書き出しのエンコーダ方式
- **関連**: `adr/0002-ffmpeg-codec.md` / `research/ffmpeg-openh264-windows.md` / `adr/0001` / `adr/0006` / `13_DEPENDENCIES_AND_LICENSING.md §3,§9`
- **重要な前提**: 当初は調査と推奨までの資料。
- **結果（2026-06-18 更新）**: 推奨どおりスパイクを実施し、**案A（FFmpeg＋h264_mf）の採用を確定**（画質問題はビットレート未指定が原因で解消、機能は実機で全成功）。正式決定は [`ADR-0013`](../adr/0013-h264-via-media-foundation.md)、スパイク記録は [`spike-h264-mf-verification.md`](spike-h264-mf-verification.md)。以降この資料は判断の背景・比較として参照。

---

## 0. 要約（先に結論）

- 書き出しパイプラインは **既にコーデック非依存に抽象化済み**（`src-tauri/src/ffmpeg.rs` の `VideoCodec` enum＋`pick_codec`）。PNG生成→合成→MP4・AAC・concat・overlay・BGM ミックス・トランジションはすべてエンコーダ名を差し替えるだけで動く構造。
- したがって **案A（FFmpeg＋`h264_mf`）は最小差分**で実現でき、OpenH264 が抱える「初回ダウンロード・DLL配置・バージョン/ハッシュ検証・Cisco必須クレジット・dlopenパッチ自前ビルド」を**すべて不要化**する。
- ただし `h264_mf` の **画質・速度・Windows N での可用性・自前LGPLビルドへの実搭載**は **Windows実機でしか確認できない**。公式情報で確認できたのは「エンコーダの存在・入力形式・有効化フラグ・対応OS」まで。
- **推奨：まず小さなスパイクで `h264_mf` を実機検証 → 合格なら案A採用、OpenH264自前ビルド（案C）はオフライン用フォールバックに降格。** 詳細は §7。
- **縦型動画はコーデック選択とは独立した別軸**。どの案でも、PNG列に与える実ピクセル寸法をそのまま符号化するだけなので、縦型対応の阻害/促進要因にはならない（§1.7・§4.6）。

---

## 1. リポジトリ調査（引用付き）

### 1.1 現在の書き出し処理の全体像（ADR-0001 A2ハイブリッド）
- 静止レイヤーはプレビューと同一の Web 描画で **SVG→PNG** 化（`adr/0004` WebView Canvas）。FFmpeg は **動画スロット合成・トランジション・音声ミックス・尺・結合・エンコードに限定**（`adr/0001` 決定部）。
- フロント側の入口：[`src/app/screens/ExportScreen.tsx`](../../../src/app/screens/ExportScreen.tsx) → [`buildExportScenes`](../../../src/renderer/export/buildExportScenes.ts) で各場面PNG生成 → [`exportVideo`](../../../src/infrastructure/ffmpegExport.ts) が Tauri コマンド `export_video` を呼ぶ。
- バックエンド：[`src-tauri/src/ffmpeg.rs`](../../../src-tauri/src/ffmpeg.rs) の `#[tauri::command] export_video`（行 999〜）。

### 1.2 FFmpeg sidecar 呼び出しとコーデック抽象（**最重要**）
- `ffmpeg.rs:23-44` にコーデック抽象：
  ```rust
  pub enum VideoCodec { OpenH264, X264 }
  impl VideoCodec { pub fn encoder(self) -> &'static str {
      VideoCodec::OpenH264 => "libopenh264", VideoCodec::X264 => "libx264" } }
  pub fn pick_codec(encoders_output: &str) -> Option<VideoCodec> {
      // libopenh264 優先 → libx264 → None
  }
  ```
- `export_video`（`ffmpeg.rs:1011-1017`）は **実行時に `ffmpeg -encoders` を読み、`pick_codec` で選択**：
  ```rust
  let encoders = run(&ffmpeg, &["-hide_banner", "-encoders"])...;
  let codec = pick_codec(&encoders).ok_or_else(|| "動画の書き出し機能が使えません。…")?;
  ```
- 引数生成（`scene_clip_args` / `video_scene_args` / `concat_args` / `mix_bgm_args` / `xfade_chain_args`）はすべて **`codec.encoder()` を `-c:v` に差すだけ**でコーデック非依存。音声は一貫して `-c:a aac`、画素は `-pix_fmt yuv420p`。
- **結論：`h264_mf` 追加は「`VideoCodec` に変種を1つ追加＋`pick_codec` の検出文字列追加」で収まる。** これが本判断の土台。

### 1.3 PNGフレーム生成（寸法非依存）
- [`buildExportScenes.ts:107-117`](../../../src/renderer/export/buildExportScenes.ts)：
  ```ts
  const cw = template.canvas.width; const ch = template.canvas.height;
  const width = opts.outputSize?.width ?? cw;  // 出力解像度（未指定はキャンバス）
  const height = opts.outputSize?.height ?? ch;
  // svgToPngDataUrl(svg, width, height) で実寸PNG化、スロット矩形は rx/ry でスケール
  ```
- **PNGは与えられた width×height でそのまま焼く**＝寸法（縦横比）非依存。全場面を同一サイズで焼く（後段 `concat -c copy` の前提）。

### 1.4 音声・BGM・素材動画の合成
- ナレーション音声（VOICEVOX 由来 WAV）：`export_video` が `scene_NNN.wav` に展開し各クリップへ付与。
- 素材動画あり場面（`adr/0006`）：下PNG→動画(scale/overlay)→上PNG を `overlay`、音声は **ナレーション＋元動画音声を `amix`**、最後に **BGM を全体へ重ねる**（`mix_bgm_args`）。
- **すべてエンコーダ非依存**（コンテナ mp4・音声 aac は固定）。エンコーダを替えても合成ロジックは不変。

### 1.5 進捗通知・キャンセル
- 進捗：`ExportScreen.tsx:141-148` の `percent` は **場面PNGレンダリングの done/total（〜80%）＋エンコード固定90%＋完了100%**。**FFmpeg エンコード中の実時間進捗は無い**（`encoding` フェーズは固定値）。
- **キャンセル機能は未実装**（`startExport` は完了/失敗まで走る。AbortController 等なし）。
- → 進捗・キャンセルの作りは**どの案を選んでも同じ**（コーデックと無関係）。改善するなら別タスク。

### 1.6 開発時と配布時の FFmpeg 取り扱い
- `ffmpeg.rs` ヘッダ＆`adr/0002` 実装方針：FFmpeg は **静的リンクせず sidecar**。解決順 **環境変数 `FFMPEG_PATH` → `<appData>/bin/` → `<localAppData>/bin/` → PATH**（`resolve_ffmpeg`）。
- 現状の開発：`ffmpeg-static`（GPL/libx264）を**スパイク専用**として利用。配布版は LGPL 構成へ差し替える前提（`adr/0002` 決定）。

### 1.7 縦型・解像度・尺の現況（正典）
- 定数 `src/domain/constants.ts:14-19`：`FPS=30`、`WIDTH=1920`、`HEIGHT=1080`、`HD_WIDTH=1280`、`HD_HEIGHT=720`。`VIDEO_HARD_MAX_SEC=600`（10分）、`VIDEO_TARGET_MAX_SEC_MVP=300`（5分）。
- **スキーマ（正典）が縦型を禁じている**：`schemas/project.schema.json` VideoSettings は `aspectRatio: enum ["16:9"]`、`width: const 1920`、`height: const 1080`、`fps: const 30`。
- 縦型は **MVP 除外・将来対応**：`01_REQUIREMENTS §16.2`／`02_MVP_ROADMAP §4`／`CLAUDE.md §10`（「縦・正方形動画」は MVP でやらない）、`01 §4.2`／`05_RENDERING_SPEC §4`（将来 9:16 1080×1920）。
- ExportScreen のサイズ選択は **フルHD/HD（ともに16:9）のみ**（`ExportScreen.tsx:41-42`）。
- → **ユーザー指定「縦型必須」と現行正典は不一致**。これはコーデック判断とは別の、データモデル＋テンプレ＋UIの横断変更（§4.6 で扱う）。

### 1.8 既に入っている OpenH264 関連成果物（PR影響範囲）
| 場所 | 役割 | 由来 |
|---|---|---|
| `ffmpeg.rs:23-44` `VideoCodec`/`pick_codec` | コーデック抽象（OpenH264優先） | 既存（ADR-0002実装） |
| `ffmpegExport.ts` `ExportReport.codec` | 使用エンコーダ名を返す（UI非表示） | 既存 |
| `adr/0002-ffmpeg-codec.md` | FFmpeg/H.264 決定 | 既存 |
| `research/ffmpeg-openh264-windows.md` | 自前ビルド＋dlopen＋初回取得の調査 | **PR #114** |
| `domain/export/h264Feature.ts`＋`.test.ts` | 状態型 `unavailable/ready/disabled/error/verificationRequired`、`OPENH264_FEATURE_ENABLED=false`、必須クレジット文字列 | **PR #115** |
| `SettingsScreen.tsx` H.264機能セクション | 状態ラベル＋詳細（OpenH264/Cisco/版/検証/配置）、既定非表示 | **PR #115** |
| `AboutScreen.tsx` credits | OpenH264 クレジット（`OPENH264_FEATURE_ENABLED` でゲート） | **PR #113/#115** |

> **重要**：#115 の状態型・UI枠は**バイナリ非依存・機能フラグ既定OFF**で作ってある。案Aに進んでも**捨てずに再利用できる**（状態の意味を OpenH264 取得状況 → エンコーダ可用性に読み替えるだけ）。§6 参照。

---

## 2. 候補方式の比較（案A／案B／案C／予備）

| | 概要 | FFmpegパイプライン | H.264の出所 | 配布バイナリ |
|---|---|---|---|---|
| **案A** | FFmpeg ＋ `h264_mf`（sidecar維持、MFのH.264エンコーダ） | **そのまま流用** | OS（Media Foundation、MicrosoftがMFTを提供） | LGPL FFmpeg（`--enable-mediafoundation`） |
| **案B** | MF専用 Rust/C++ ヘルパー（Sink Writer で直接符号化） | **置換（合成も自作）** | OS（Media Foundation） | 自作ヘルパー＋（合成用に結局FFmpeg併用の可能性） |
| **案C** | 自前ビルド LGPL FFmpeg ＋ Cisco OpenH264 初回取得（現行計画） | そのまま流用 | OpenH264（Cisco配布バイナリ） | 自前ビルド＋dlopenパッチ＋初回DL |
| 予備 | WebM/VP9・Opus 任意出力 | そのまま流用（`-c:v libvpx-vp9 -c:a libopus`） | ロイヤリティフリー | LGPL FFmpeg（libvpx同梱） |

- **案B評価**：合成（overlay/xfade/amix/BGM）も自作することになり、現に動いている資産を捨てる。工数最大・手戻り最大。**将来 FFmpeg 完全排除を要件化した場合の超長期オプション**に留める。本判断では非推奨。
- **予備（WebM）評価**：特許を完全回避できるが、**PowerPoint 埋め込み・一部Windows標準プレーヤーの互換が落ちる**（要件＝採用サイト/会社説明会PowerPoint）。`adr/0002` も「将来の任意出力」。主方式にはしない。

---

## 3. 比較表（約30観点）

> 凡例：◎優位 / ○可 / △課題 / 【実機】＝Windows実機検証が必要

| # | 観点 | 案A：FFmpeg+h264_mf | 案C：自前LGPL+OpenH264初回取得 | 案B：MF専用ヘルパー |
|---|---|---|---|---|
| 1 | 実装差分（コード変更量） | ◎ `VideoCodec`変種＋`pick_codec`検出のみ | △ ビルド系＋取得/検証/配置の本実装 | ✗ 合成含む大規模新規 |
| 2 | 工数 | ◎ 小（＋スパイク） | △ 中〜大 | ✗ 大 |
| 3 | 手戻り範囲 | ◎ 局所（ffmpeg.rs中心） | △ 取得UX・配置・検証に波及 | ✗ パイプライン全域 |
| 4 | 保守性 | ◎ OS任せ・更新追従不要 | △ 版pin/ハッシュ/dlopenパッチ追従 | △ 自作MFコード保守 |
| 5 | ビルド再現性 | ○ 構成は単純だが**自前LGPLビルドに実搭載か 【実機】** | △ パッチ当てビルドの再現が重い | △ |
| 6 | ライセンス | ◎ LGPL＋OSコーデック（§9） | △ LGPL＋Cisco配布条件＋必須クレジット | ○ |
| 7 | 外部ダウンロード要否 | ◎ 不要 | ✗ 初回にCiscoから取得が前提 | ◎ 不要 |
| 8 | オフライン動作 | ◎ 初回からオフライン可 | ✗ 初回はネット必須 | ◎ |
| 9 | 社内プロキシ環境 | ◎ 影響なし | ✗ プロキシ/遮断で初回失敗の恐れ | ◎ |
| 10 | Windows環境差（N/KN等） | △ **Windows N/KNはMedia Feature Pack無しでMFのH.264が欠ける 【実機】** | ○ 取得さえ済めば環境差小 | △ 同左 |
| 11 | 診断しやすさ | ○ `ffmpeg -encoders`で可用性判定（既存機構） | △ DLL有無/版/ハッシュの不一致要因が多い | △ |
| 12 | 横型 1920×1080 | ◎（現行どおり） | ◎ | ○ |
| 13 | 縦型 1080×1920 | ○ コーデック非依存（実ピクセル符号化）【実機】（実機で実寸出力確認） | ○ 同左 | ○ |
| 14 | 30秒 | ◎ | ◎ | ○ |
| 15 | 10分 | ○ 【実機】（長尺の安定/速度） | ○ 【実機】 | ○ |
| 16 | VOICEVOX音声 | ◎ 不変（`-c:a aac`） | ◎ | △ 自作合成要 |
| 17 | BGM | ◎ 不変（`mix_bgm_args`） | ◎ | △ |
| 18 | 素材動画の音声 | ◎ 不変（`amix`） | ◎ | △ |
| 19 | PowerPoint互換 | ○ 標準H.264/AAC/mp4 【実機】（実挿入確認） | ○ 【実機】 | ○ 【実機】 |
| 20 | Windows再生 | ○ 標準mp4 【実機】 | ○ 【実機】 | ○ |
| 21 | YouTube | ◎ 標準H.264/AACで問題想定なし | ◎ | ◎ |
| 22 | エンコード速度 | △ HW経路は速い可能性／SW経路は機種差 【実機】 | ○ SWで一定（やや遅め） | △ 【実機】 |
| 23 | CPU/GPU | △ HW(GPU)/SW(CPU)を選べる（`hw_encoding`）【実機】 | ○ SW(CPU)固定 | △ |
| 24 | 画質（同ビットレート） | △ MFのH.264品質は機種差 【実機】 | △ OpenH264はおおむねConstrained Baseline寄り | △ |
| 25 | ファイルサイズ | △ 【実機】（libx264比較） | △ libx264より大きめ（`adr/0002`） | △ |
| 26 | 将来 macOS/Linux | △ MFはWindows専用→他OSは別エンコーダ必須 | ○ OpenH264はクロスプラットフォーム | ✗ Windows専用 |
| 27 | テスト容易性 | ◎ `pick_codec`/引数生成は純粋関数で単体テスト可 | ◎ 同左 | △ |
| 28 | CI検証可能性 | △ 実符号化はWindows実機/ランナー必須 【実機】 | △ 同左 | △ |
| 29 | 利用者の初期設定/エラー | ◎ 追加設定ほぼ不要 | △ 初回取得の説明・失敗時導線が必要 | ◎ |
| 30 | 総合 | **本命（要スパイク）** | フォールバック | 非推奨（超長期） |

---

## 4. Media Foundation（h264_mf）実現可能性

### 4.1 公式情報で確認できた事実（断定可）
出典：FFmpeg 上流コミット「avcodec: Add MediaFoundation encoder wrapper」、gyan.dev builds、FFmpeg codecs ドキュメント目次。
- **エンコーダ**：`h264_mf`／`hevc_mf`／`aac_mf`／`ac3_mf`／`mp3_mf` を追加（"This contains encoder wrappers for H264, HEVC, AAC, AC3 and MP3."）。H.264 は `h264_mf`。
- **入力画素形式**：`AV_PIX_FMT_NV12, AV_PIX_FMT_YUV420P`。コミット曰く "Video encoders can take input in either of nv12 or yuv420p form … in practice, **nv12 is the safer choice, especially among HW encoders**."
  - → 現行パイプラインの `-pix_fmt yuv420p` は**受理される**。HW経路の堅牢性のため `nv12` 指定が無難な可能性（小さな調整候補）。
- **ソフト/ハード両対応**：オプション `hw_encoding`（BOOL, 既定 0＝"Force hardware encoding" を強制しない）。**ソフトウェア経路が存在**＝GPU非依存で動かせる余地。
- **有効化フラグ**：`--enable-mediafoundation`。**GPL/nonfree フラグではない**（Windowsシステムライブラリ mf/mfplat/mfuuid/ole32 等とリンク）＝**LGPL構成（`--enable-gpl`なし・libx264/x265/openh264なし）と両立可能**。
- **対応OS**：Windows のみ、最小 **Windows 8**（`_WIN32_WINNT < 0x0602` を要求）。
- **公開ビルドでの存在傍証**：gyan.dev の Windows ビルドは構成に `mediafoundation` を含む（ただし gyan は GPLv3 で libx264/x265 込み＝**h264_mf が Windows ビルドで利用可能なことの傍証**であって、配布する LGPL ビルドそのものではない）。
- **AAC＋MP4**：FFmpeg ネイティブ `aac` エンコーダと mp4 マルチプレクサは**外部ライブラリ不要の組み込み（LGPL）**。現行パイプラインが既に `-c:a aac` で使用中＝**MF採用でも音声は `aac`（ネイティブ）で据え置き**（`aac_mf` は不要）。

### 4.2 ビルド条件（確認できた範囲）
- LGPL FFmpeg を `--enable-mediafoundation` 付きで構成すれば、**libx264/libx265/libopenh264・`--enable-gpl`・`--enable-nonfree` 無し**で H.264 出力が成立し得る（MFはOS提供）。
- ただし「**自前の LGPL ビルドの `ffmpeg -encoders` に実際に `h264_mf` が出るか**」は、ビルドして実機で確認するまで**断定しない**（【実機】）。

### 4.3 PNG列入力／NV12変換の要否
- 入力は引き続き「PNG（`-loop 1`）→ `-pix_fmt yuv420p`」で受理されるはず。**yuv420p で足りるか、nv12 を明示すべきか**は 【実機】（特にHW経路）。コード変更が要っても `-pix_fmt nv12` の1語。

### 4.4 ソフト経路/HW無効化の安定性
- `hw_encoding=0`（既定）でソフトMFTを使えば**機種差・GPUドライバ差を避けやすい**＝再現性重視ならソフト固定が候補。**ソフト経路の安定性・速度**は 【実機】。

### 4.5 Windows N/KN・Media Feature Pack 検出／事前能力チェック
- Windows N/KN は Media Feature Pack 未導入だと **MF の H.264 MFT が存在しない**可能性 → `h264_mf` が `-encoders` に出ない/初期化失敗。
- **事前能力チェックは既存機構で可能**：`export_video` は既に `ffmpeg -encoders` を読んで `pick_codec` している（`ffmpeg.rs:1011-1017`）。ここに `h264_mf` 検出を足せば、**書き出し前に可用性を判定**でき、無ければフォールバック/行動明示エラーへ誘導できる。実際の N/KN 挙動は 【実機】。

### 4.6 縦型 1080×1920 を「実ピクセル」で出せるか
- 本パイプラインは **PNG列を実寸ラスタライズして符号化**する方式（`buildExportScenes.ts`）。回転メタデータではなく**実ピクセルのフレーム**を渡すので、縦型は**真の1080×1920ピクセル**で出る。これは **h264_mf でも OpenH264 でも同じ**（エンコーダは与えた実ピクセルを符号化するだけ）。
- ただし縦型を出すには **コーデックではなく**：`project.schema.json`（`width/height/aspectRatio` の const/enum 緩和）＋テンプレ canvas（縦キャンバス）＋ExportScreen のサイズ選択＋ゴールデンテンプレの整備が必要。**方式判断とは独立した別タスク**。実寸出力自体は 【実機】（縦寸での書き出し確認）。

---

## 5. MF と OpenH264 で「利用者から見た」差分

- **仕上がりMP4はほぼ同等**：どちらも **標準の H.264（mp4コンテナ・AAC音声）**。再生・PowerPoint挿入・YouTube投稿の観点では**実質的に同じファイル**として扱える（細部のビットレート傾向・画質は異なり得る＝【実機】）。
- **差が出るのは「作り方」**：
  - 案A（MF）：追加の初期設定・ダウンロードが**不要**。利用者は普段どおり「動画を出力」を押すだけ。エラーは「この端末では動画保存機能が使えません（環境を確認）」のような能力ベースの行動明示に集約できる。
  - 案C（OpenH264）：**初回にネット取得**が要る → 取得中表示・取得失敗（プロキシ/遮断/オフライン）時の導線・再試行が必要。非技術者には負担。
- クレジット：案C は **必須クレジット "OpenH264 Video Codec provided by Cisco Systems, Inc." の常時表示義務**。案A は MF（OS）使用のためこの義務は無い（FFmpeg自体のLGPL表記・ソース提供は両案共通＝既にAbout画面に実装済み）。

---

## 6. 既存コードへの影響分類

| 分類 | 対象 | 備考 |
|---|---|---|
| **そのまま流用** | `buildExportScenes.ts`／`scene_clip_args`・`video_scene_args`・`concat_args`・`mix_bgm_args`・`xfade_chain_args`／`resolve_ffmpeg`／`ExportScreen`／`ffmpegExport.ts` の I/F | コーデック非依存。案Aで無改修 |
| **軽微修正** | `ffmpeg.rs` `VideoCodec`（`MediaFoundation` 変種追加, `encoder()`→`"h264_mf"`）＋`pick_codec`（`h264_mf` 検出・優先順位）＋必要なら `-pix_fmt nv12` | 案Aの中心変更。数十行 |
| **抽象化が必要** | `pick_codec` の優先順位ポリシー（MF>OpenH264>libx264 等）を定数/設定化 | 将来差し替え容易性のため |
| **作り直し** | （案Aでは無し）／案Bなら合成全般 | — |
| **削除可能** | 当面なし | — |
| **OpenH264前提で今は不要化** | `research/ffmpeg-openh264-windows.md` の「初回取得/dlopen/版pin」本実装、`h264Feature.ts` の取得・検証・配置の将来実装 | **案A採用時はフォールバック資料として保持**。状態型・UI枠（#115）は**エンコーダ可用性表示として再利用**（捨てない） |

> #115 の `H264FeatureStatus`（`unavailable/ready/disabled/error/verificationRequired`）と設定画面の「H.264動画保存機能」枠は、**「OpenH264取得状況」から「H.264書き出しの可用性」への読み替え**でそのまま活きる。クレジットゲート `OPENH264_FEATURE_ENABLED` は「MF採用時は false 維持＝Cisco表記を出さない」で整合。

---

## 7. 推奨

- **推奨方式**：**まず小スパイクで `h264_mf` を実機検証 → 合格なら案A（FFmpeg＋h264_mf）を主方式に採用し、案C（自前LGPL＋OpenH264初回取得）はオフライン/Windows N 等のフォールバックに降格。**
- **結論**：現行のコーデック抽象（`VideoCodec`/`pick_codec`）により案Aは最小差分で、OpenH264のダウンロード・DLL・版/ハッシュ・必須クレジット・dlopen自前ビルドという**運用上の重荷をすべて外せる**。一方で `h264_mf` の品質・速度・Windows N可用性・自前LGPLビルドへの実搭載は**実機未確認**のため、本実装前に使い捨てスパイクで確かめるのが筋。
- **確信度**：**案Aが目標として妥当＝高 / スパイクが合格する見込み＝中〜高（実機未確認のため断定しない）**。
- **主な理由（3点）**
  1. パイプラインが既にコーデック非依存＝**案Aは数十行の局所変更**で、動いている合成・音声・トランジション資産を一切捨てない。
  2. **ダウンロード/オフライン/社内プロキシ/必須クレジットの問題を構造的に解消**（OS提供コーデック）。非技術者UX要件に最も適合。
  3. 公式情報で「h264_mf の存在・yuv420p/nv12入力・`--enable-mediafoundation`がLGPLと両立・Windows8+・ソフト経路あり」まで確認済み＝**実現性の土台は固い**。
- **採用条件（3点）**
  1. スパイクで自前相当の **LGPL FFmpeg（`--enable-mediafoundation`、libx264/x265/openh264なし）の `-encoders` に `h264_mf` が出る**ことを実機確認。
  2. 横型1920×1080・縦型1080×1920・30秒・10分で **再生/PowerPoint挿入/ffprobe整合**が実機で問題ないこと。
  3. 画質・速度・ファイルサイズが採用動画用途に実用域（libx264スパイク比較で許容内）であること。
- **不採用条件（3点）**
  1. 対象端末群に **Windows N/KN が多く Media Feature Pack 前提にできない**（→ 案Cフォールバック必須度が上がる）。
  2. スパイクで **ソフト経路でも品質/速度が実用外**、または HW依存が強く機種差が大きい。
  3. 将来 **macOS/Linux 配布が早期に要件化**（MFはWindows専用→クロス対応のOpenH264/別案が要る）。
- **Windows実機で確認する項目（3点）**
  1. 自前LGPLビルドの `ffmpeg -encoders | h264_mf` 実出力、および Windows N/KN での可用性と事前検知。
  2. 縦横・30秒/10分の実書き出し（実ピクセル寸法・ffprobe・各プレーヤー＆PowerPoint再生）。
  3. `hw_encoding` ソフト固定 vs 既定 の品質・速度・安定性、`yuv420p` で足りるか `nv12` 必須か。

---

## 8. スパイク計画（製品と分離・使い捨て）

> 目的：`h264_mf` が本パイプラインで実用かを**最小コストで実機判定**する。製品コードへは原則マージしない検証ブランチで行う。

### 8.1 検証項目
1. h264_mf を含む Windows FFmpeg を `<appData>/bin/` か `FFMPEG_PATH` に配置（例：mediafoundation 入りビルド）。`ffmpeg -encoders` で `h264_mf` 確認。
2. PNG列（横1920×1080／縦1080×1920）＋ WAV（VOICEVOX相当）→ `-c:v h264_mf -c:a aac` で mp4 出力（`-pix_fmt yuv420p` と `nv12` 両方）。
3. `hw_encoding` 既定（HW可）とソフト固定の両方を試す。
4. 30秒・10分の2尺で書き出し。
5. `ffprobe` で解像度・コーデック・尺・ストリーム整合を確認。Windows標準プレーヤー＆PowerPoint挿入で再生確認。
6. 同条件の libx264 スパイクと **時間・サイズ・体感画質**を比較。
7. （可能なら）Windows N 相当環境で可用性/失敗時挙動を確認。

### 8.2 変更範囲（スパイク限定）
- `ffmpeg.rs`：`VideoCodec::MediaFoundation`（`encoder()`→`"h264_mf"`）と `pick_codec` の検出を**一時追加**。必要なら `-pix_fmt nv12`。
- それ以外（合成・音声・UI）は**触らない**。

### 8.3 成果物
- 検証ログ（コマンド・ffprobe出力・所要時間・サイズ・再生可否・スクリーンショット）を `research/` に追記。
- 合否判定（採用条件§7を満たすか）と、本実装時の確定パラメータ（pix_fmt/hw_encoding/優先順位）。

### 8.4 受け入れ基準
- 横/縦・30秒/10分すべてで mp4 が生成され、ffprobe 整合＋標準プレーヤー/PowerPoint で再生可。
- 品質・速度が採用動画用途で実用域。
- Windows N での挙動（可用 or 事前検知して行動明示）に見通しが立つ。

### 8.5 使い捨てコードの扱い
- スパイクの `VideoCodec`/`pick_codec` 追加は、合格後に**正式実装として整理し直す**（優先順位の定数化・テスト追加）。不合格なら破棄し案Cへ。

---

## 9. ライセンスの切り分け（コードで確認できる事 / 社内確認が要る事）

> 法的判断は下さない。**コード/構成で確認できる範囲**と**社内（法務）確認が要る範囲**を分ける。

| 論点 | 案A（MF） | 案C（OpenH264） | 区分 |
|---|---|---|---|
| FFmpeg 本体のLGPL配布（`--enable-gpl`なし・動的リンク・ソース提供） | 必要（両案共通） | 必要 | **構成で確認可**（configure内容・About画面のソース入手先＝実装済み） |
| H.264エンコーダの出所 | OS（Media Foundation、MicrosoftがMFTを提供） | Cisco配布のOpenH264バイナリ | 構成で確認可 |
| エンコーダ追加が `--enable-gpl/nonfree` を要するか | **不要**（`--enable-mediafoundation` はシステムAPI連携） | 不要（`--enable-libopenh264`） | 構成で確認可 |
| 配布バイナリの同梱可否 | OSコンポーネントのため同梱問題なし | **同梱不可**（"ダウンロード前に第三者ソフトへ統合しない"条件）＝初回取得 | 構成で確認可 |
| 必須クレジット | MF（OS）には固有の常時表示義務なし | **"OpenH264 Video Codec provided by Cisco Systems, Inc." 常時表示が必要** | 構成で確認可（表示はAbout/設定にゲート実装済み） |
| 完成H.264コンテンツ（MP4）の配布で AVC ロイヤリティ要否 | **MFが解決しない**（H.264規格の問題でエンコーダ実装と別軸） | **同左** | **社内（法務）確認**（MPEG-LA。ただし本ソフトの想定は無収益用途＝リスク低） |
| AAC音声の特許背景 | ネイティブaac使用（実害小、`adr/0002`） | 同左 | 社内確認（影響小） |

- **MFが解決する事**：OpenH264 の「同梱不可・初回取得・DLL/版/ハッシュ・dlopenパッチ・Cisco必須クレジット」という**配布/運用の制約を不要化**。
- **MFでも残る事**：H.264 という**規格自体**に関わる商用配布の MPEG-LA 許諾要否（＝エンコーダをOSに替えても消えない別軸）。本ソフトは無収益用途想定でリスクは低いが、最終判断は社内確認事項（`13 §9` の継続課題）。

---

## 参考（出典）
- FFmpeg 上流コミット「avcodec: Add MediaFoundation encoder wrapper」（h264_mf/hevc_mf/aac_mf/ac3_mf/mp3_mf、hw_encoding、NV12/YUV420P、`--enable-mediafoundation`、Windows 8+）。
- gyan.dev FFmpeg builds（構成に mediafoundation、ただし GPLv3 ＋ libx264/x265）。
- FFmpeg Codecs Documentation（ネイティブ aac エンコーダ、MediaFoundation 節）。
- 社内：`adr/0002-ffmpeg-codec.md`、`research/ffmpeg-openh264-windows.md`、`13_DEPENDENCIES_AND_LICENSING.md §3,§9`。
</content>
</invoke>
