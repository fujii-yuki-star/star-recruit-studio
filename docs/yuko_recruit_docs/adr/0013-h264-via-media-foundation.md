# ADR-0013: H.264 書き出しを Media Foundation（h264_mf）主経路にする

- **状態**: Accepted（2026-06-18 承認。実機スパイクで確証）
- **日付**: 2026-06-18
- **関連 / 一部supersede**: `ADR-0002`（FFmpeg=LGPL方針は維持・H.264エンコーダ選択を本ADRで更新）/ `research/export-encoder-mediafoundation-vs-openh264.md` / `research/spike-h264-mf-verification.md` / `13_DEPENDENCIES_AND_LICENSING.md §3,§9` / `ADR-0001`

---

## コンテキスト

`ADR-0002` は H.264 エンコーダに **OpenH264（Cisco配布バイナリ）** を選んだが、その後の調査（`research/export-encoder-mediafoundation-vs-openh264.md`）で次が判明した。

- 書き出しは **既にコーデック非依存に抽象化済み**（`src-tauri/src/ffmpeg.rs` の `VideoCodec` ＋ `pick_codec`。`export_video` が実行時に `ffmpeg -encoders` を読んで選択。合成/音声/concat/overlay/BGM/transition はすべてエンコーダ名非依存）。
- OpenH264 方式は「同梱不可・初回ダウンロード（社内プロキシ/オフラインで失敗し得る）・DLL/版/ハッシュ検証・dlopen パッチ自前ビルド・Cisco 必須クレジット」という配布/運用の重荷を伴う。
- `h264_mf`（Windows Media Foundation の H.264）は **OS提供コーデック**で、上記の重荷を構造的に不要化できる。`--enable-mediafoundation` は GPL/nonfree フラグではなく **LGPL 構成（`--enable-gpl`なし・libx264/x265/openh264なし）と両立**（FFmpeg 上流コミットで確認）。

### 実機スパイクの結果（`research/spike-h264-mf-verification.md`）
- 機能：横 1920×1080・縦 1080×1920（実ピクセル）・30秒・10分・PNG入力・**アプリの実パイプラインまでエラーなし**。
- 品質：当初の画質悪化は **本ソフトがビットレートを未指定だった**ことが原因（libx264 は CRF23 既定で良好／h264_mf は既定ビットレートが低い）。**`h264_mf -b:v 12M` が `libx264 -crf23` 同等画質**であることを実機確認。ユーザー方針＝**品質優先・最低 12M**。

## 判断軸

特許ライセンス不要 ／ 互換性（採用サイト・YouTube・会社説明会の PowerPoint 埋め込み）／ LGPL 遵守 ／ 配布/運用の簡潔さ ／ 非技術者 UX ／ 将来のエンコーダー差し替え容易性。

## 決定

> **H.264 書き出しの主経路を Media Foundation（`h264_mf`）とする。** 配布版 FFmpeg は **LGPL 構成＋`--enable-mediafoundation`（libx264/x265/openh264・`--enable-gpl` なし）**。
> **OpenH264 はフォールバック**（`h264_mf` が無い環境向けに `pick_codec` で次点。実装は将来必要時に `research/ffmpeg-openh264-windows.md` の方式で）。**libx264 は開発用のみ**（GPL・配布不可）。
> 音声は引き続き **ネイティブ `aac`（LGPL 組込）**、コンテナは mp4。
> 画質は **エンコーダ別に目標ビットレートを明示**（MF は `-b:v 12M`＝`MF_TARGET_BITRATE`、品質優先・最低 12M。x264 は CRF 既定のまま）。

`pick_codec` の優先順位＝**h264_mf → libopenh264 → libx264**。

## 結果・影響

- **不要化されたもの（主経路）**：OpenH264 の初回ダウンロード・同梱可否・DLL/版/ハッシュ検証・dlopen パッチ自前ビルド・Cisco 必須クレジット常時表示。→ オフライン/社内プロキシ環境でも初回から動作。
- **コード**：`VideoCodec::MediaFoundation`（`encoder()`→`h264_mf`）＋`quality_args()`（MF にのみ `-b:v 12M`）。3つのエンコード箇所（`scene_clip_args`/動画シーン/`xfade` 再エンコード）に適用。x264/OpenH264 経路は出力不変。単体テスト緑。
- **対応 OS**：Windows 8 以上（Media Foundation 要件）。**Windows N/KN は Media Feature Pack 未導入だと `h264_mf` が無い**可能性 → `export_video` は既に `ffmpeg -encoders` を読むので事前検知でき、無ければフォールバック/行動明示エラーへ誘導可能。
- **ファイルサイズ**：固定ビットレートのため x264 の効率的 VBR より大きめ（10分・12M で約900MB目安）。**品質優先方針として許容**。サイズ最適化（解像度別ビットレート・品質ベース RC）は将来課題。
- **仕上がり MP4**：標準 H.264/AAC/mp4 ＝ 再生・PowerPoint 挿入・YouTube で OpenH264 版と実質同等。

## 検証結果（2026-06-18・Windows 実機）

- **配布用 LGPL ビルドでの `h264_mf` 実搭載＝確認済（自前ビルド不要）。** BtbN `win64-lgpl`（master-latest, static）で確認：`-buildconf` に `--disable-libx264`/`--disable-libx265`（GPL なし）、`-encoders` に `h264_mf`（"H264 via MediaFoundation"）が実在。さらに `FFMPEG_PATH` を当該ビルドへ向けたアプリ実書き出しも h264_mf 選択で良好画質に成功。
  - `--enable-mediafoundation` は buildconf に明示されない＝自動検出（`-encoders` の h264_mf 実在が正）。
  - 同ビルドは `--enable-libopenh264`（BSD ソースを静的同梱）も持つが、`pick_codec` が h264_mf を優先するため **未使用**。これは Cisco 配布バイナリではない＝AVC 特許カバレッジは付かないが、使わないので無関係。
- アプリ UI「H.264動画保存機能」（旧 #115）→ PR#115 で「主経路=MF／予備=OpenH264」表示に読み替え済み（マージ済）。

## 未解決の論点（配布前に確認）

- **配布形態**：LGPL 遵守は **`win64-lgpl-shared`（動的リンク）＋ FFmpeg ソース提供**が素直（ADR-0002）。今回検証は static。静的 LGPL は再リンク手段の提供が必要。
- **使用ビルド/バージョンの pin**（BtbN リリースブランチの固定・ハッシュ記録）。同梱 openh264 を外した最小構成（`--disable-libopenh264` の自前ビルド）は任意の最適化。
- **Windows N/KN** の実挙動（Media Feature Pack 欠如時の `h264_mf` 不在）と事前検知メッセージの整備。
- **ファイルサイズ最適化**（720p で 12M は過剰・解像度別/品質RC）。
- **完成 H.264 コンテンツの MPEG-LA 許諾要否**（規格自体の別軸＝MF でも残る。無収益用途でリスク低・社内確認継続）。
