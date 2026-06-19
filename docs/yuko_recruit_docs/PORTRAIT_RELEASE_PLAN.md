# 縦型対応＋α版リリース固め 実装計画

> 本書は α版（縦型動画対応を含む）に向けた**実装計画と作業仕様**。`02_MVP_ROADMAP.md`（フェーズ）と [`adr/0012`](adr/0012-aspect-ratio-and-portrait.md)（縦型・Accepted）を実作業に落としたもの。**#118 の縦型本体は Workflow（ファンアウト）で実施**する前提の入力仕様も兼ねる。
> 状態: 計画（2026-06-19 確定）。実装着手はこの順序に従う。正典（schemas/CLAUDE.md）変更は §8 のとおり ADR 先行。

## 0. スコープと前提

- **確定スコープ（α版）**: A群（A1・A3）＋ B群（縦型 #118）。**C群（配布パッケージング・法務）は事業/法務の決定待ちで実装対象外**。
- **縦型の確定事項**（[`adr/0012`](adr/0012-aspect-ratio-and-portrait.md) Accepted・記録 PR#126）:
  1. 比率＝**9:16 のみ**（1080×1920）。1:1 正方形は schema 枠のみ残し将来拡張。
  2. 縦テンプレ＝**全9カテゴリ**（opening/closing/photo_intro/video_intro/point_list/message/full_visual/chapter/no_yuko）＋ free。
  3. 既存16:9＝**16:9固定の移行**＋アプリ内**「向き変更（16:9⇆9:16）」導線**も提供。
  4. 尺上限＝**横型と同じく踏襲**（`VIDEO_HARD_MAX_SEC=600` 等）。
- **設計レビューで反映した方針（2026-06-19）**:
  - 縦テンプレは golden だけで固めない＝**目視デザインゲート**を必須化（§B3）。
  - 書き出しビットレートは高さ基準でなく**総画素数基準**（§A1）。
  - 向き寸法の**単一の真実（SoT）は `aspectRatio`**。width/height は導出（§B0）。
  - 旧A2「クレジット焼き込み」は**ソフト利用クレジットと成果物クレジットを分離**し、**C群（運用方針）とセットで扱う中リスク項目に再分類**（§C）。

---

## A群: 小さい独立改善（逐次PR）

### A1. 書き出しビットレートを総画素数ベースに（#121）
- **現状**: `src-tauri/src/ffmpeg.rs` `MF_TARGET_BITRATE="12M"` 固定（`quality_args()` が常に `-b:v 12M`）。720p で過剰、縦型を高さ/幅で判定すると誤る。
- **方針**: **総画素数（width×height）× fps ベースの連続式**。`bitrate ≈ bpp × pixels × fps`（bpp≒0.19）。floor/ceil を設ける。
  - 例: 1920×1080@30 ≈ 12M ／ 1080×1920@30 ≈ 12M（縦も同じ＝向き非依存）／ 1280×720@30 ≈ 5–6M ／ 540×960@30 ≈ 3M。
  - 下限・上限（例: min 3M / max 12–16M）。fps は現状30固定だが将来対応で式に含める。
- **変更**: `ffmpeg.rs` の `quality_args()` を `quality_args(width,height,fps)` 化し、`export_video` の出力寸法から算出。しきい値/係数は Rust 側定数に集約。`TODO@36` を解消。
- **テスト**: cargo 単体（2.07MP→12M、0.92MP→5–6M、0.52MP→3M、境界、上下限クランプ）。既存 MF ビットレートテストを総画素ベースに更新。
- **PR/依存**: Rust 1本・依存なし。**最初に着手（最小・低リスク・縦型にも自動で効く）**。

### A3. 大容量素材のメモリ消費（#48）
- **現状**: `assetFs.ts:16` `readAsDataURL` ／ `ExportScreen.tsx:64` ／ `rasterize.ts:29` `toDataURL` が巨大 base64 をメモリ展開。
- **方針**: 取り込みは Rust が `fs::copy` 済 → JS の data URL 化をやめ**ファイルパス受け渡し**（Tauri asset protocol でプレビュー）。書き出しPNGは blob/一時ファイル経由で Rust へ（巨大 base64 を IPC に載せない）。小画像/サムネは data URL 据え置き（しきい値）。
- **テスト**: 既存書き出し golden の非回帰＋手動メモリ確認。
- **PR/依存**: 中規模・リスク中。**α必須でなく堅牢性＝後半**。

---

## B群: 縦型 #118（Workflow で実施）

依存順: **B0 → B1 → B2 → B3 → B4 → B5 → B6**。

### B0. schema 土台（最初・要レビュー）— SoT は aspectRatio
- **正典 SoT**: 向き・寸法の真実は **`aspectRatio`** に一本化。`VideoSettings` から**権威的 width/height を外す**（保存は `aspectRatio` ＋ `fps`）。寸法は `dimsForOrientation(aspectRatio)` で導出。
  - 出力解像度（フルHD/軽量縦）は**書き出し時の別選択**でプロジェクト正典に保存しない（`constants` の `HD_*` が既に「出力時の選択肢」と分離済み）。
  - `template.canvas` は**テンプレ自身の設計座標空間**として保持（`template.aspectRatio` で向きを持つ。B4 でプロジェクト向きと一致検証）。
- **`schemas/project.schema.json`**: `schemaVersion` `"1.1"→"1.2"`。`VideoSettings.aspectRatio` `["16:9"]→["16:9","9:16"]`。width/height の `const` を撤廃（権威から外す。残すなら導出値の冗長保存＝読込時に正規化）。fps const30・尺 maximum 据え置き。
- **`schemas/template.schema.json`**: `aspectRatio` `["16:9","9:16"]`（追加は非破壊・bump任意）。
- **移行**: `src/domain/project/persistence.ts` に 1.1→1.2。**既存=16:9固定**、保存 width/height は読込時に正規化（aspectRatio から導出で上書き）。
- **fixtures**: 9:16 正常＋不整合異常を追加 → `scripts/validate-schemas.mjs`(ajv)。
- **着手前棚卸し**: `videoSettings.width/height` の参照箇所を grep（多くはテンプレ canvas/出力サイズ経由のはず）。helper 差し替えで吸収。
- **テスト**: schema 検証（16:9/9:16 正常・不整合異常）＋マイグレーション単体。

### B1. domain 型/定数
- `src/domain/enums.ts`: `Orientation = '16:9' | '9:16'`。
- `src/domain/project/types.ts`: `VideoSettings.aspectRatio: '16:9'` → `Orientation`。width/height は SoT から除外（B0）。
- `src/domain/constants.ts`: `PORTRAIT_WIDTH=1080`/`PORTRAIT_HEIGHT=1920`、`dimsForOrientation()`、縦型軽量（例 540×960）。横型既定 WIDTH/HEIGHT は維持。
- **テスト**: 向き→寸法導出の単体。

### B2. 動的テンプレ読込（＝項目4・縦型と相乗）
- **現状**: `src/infrastructure/sampleData.ts` 固定（L2 に「フォルダ読込へ置換」明記）。
- **変更**: `infrastructure/templateFs.ts`（新規＝フォルダ/ZIP 読込→ajv 検証→`Template[]`）／`projectStore.ts` の `templates` を読込結果へ（初期は同梱標準パック）／`LooksScreen` にパック読込導線（§2-3 表示語）。
- **テスト**: 読込・検証（正常/不正）・向きフィルタ。

### B3. 縦型テンプレ作成（全9カテゴリ＋free）— **目視デザインゲート必須**
- **作業**: 1080×1920 の縦レイアウトを全9カテゴリ＋free で新規作成（同梱パック）。座標・ゆうこ位置・字幕帯・タイトルを縦構図へ再設計。
- **受け入れは2段階**（golden だけで固めない）:
  1. **デザインゲート（先）**: 各縦テンプレを**代表サンプル内容で PNG レンダリング**（ADR-0001 スパイクの resvg/Canvas 経路）→ チェックリスト点検 → **ユーザー最終承認**。
  2. **golden は承認後に作成**（承認済みデザインを回帰固定）。
- **デザインチェックリスト**:
  - 字幕が低すぎ/端すぎないか／**スマホ下部UI・上部ステータスバーの安全余白**を確保しているか
  - ゆうこ・ロゴが隠れない位置か／写真スロットで人物が切れにくいか（cover 時の被写体）
  - 縦型での文字量・フォントサイズが読みやすいか／会社情報が詰まりすぎていないか／コントラスト
- **テスト**: golden-file（承認後の各縦テンプレ配置PNG）。

### B4. マッピング/検証（向き整合）
- `src/domain/ai/validateVideoPlan.ts` / `transformPlan.ts`: 解決テンプレの向き＝プロジェクト向きを検証、不一致は**同カテゴリ同向きへ自動補正**（warning）。
- `12_AI_PROMPT_AND_MAPPING.md`: 向きで絞り込む旨を追記（AI出力自体は向き非依存＝ADR-0012）。
- **テスト**: 不一致補正・絞り込み単体。

### B5. UI（向き選択＋向き変更導線）
- `WizardScreen`: 新規作成で「横型(16:9)／縦型(9:16)」選択（§2-3）→ `videoSettings.aspectRatio`。
- `ExportScreen`: 出力サイズを向き追従（縦型→1080×1920／軽量縦）。
- **向き変更(16:9⇆9:16)導線**: `src/domain/project/orientationOps.ts`（新規＝各場面の templateId を同カテゴリ別向きへ写像・assetRefs/freeLayout を縦横スケール再フィット）＋UI（確認のうえ適用）。
- **レンダラ**: `buildExportScenes`/`layout`/`findVideoSlot` は寸法非依存を**テストで確認**（原則無改修）。
- **テスト**: 向き変更の写像/再フィット単体＋UI技術用語チェック。

### B6. ドキュメント追従
- `05_RENDERING_SPEC §4`・`11_SCHEMA_REFERENCE`（VideoSettings/aspectRatio/schemaVersion 1.2）・`01 §16.2`/`02 §4`。

### #118 Workflow 構成（実施時）
| Phase | 内容 | 形 |
|---|---|---|
| 1 土台 | B0 schema＋B1 型/定数 | 直列・**ユーザーレビュー必須** |
| 2 ファンアウト | B3 縦テンプレを**カテゴリ単位で並列生成 → PNGレンダリング＋チェックリスト判定**（verify）／B2 動的読込も並行 | 並列（9〜10）＋verify |
| 3 結線 | B4 マッピング・B5 UI/変換 | 直列〜小並列 |
| 4 検証 | 全テスト＋判断層レビュー（/canon-check 相当）＋**B3 の最終目視承認はユーザー** | 集約 |
- 各フェーズ成果はレビュー＆PR。**コスト注記**: Phase2 の並列が週次枠を多めに消費（着手時に規模提示）。

---

## C群: 配布パッケージング・法務（実装対象外・決定待ち）

事業/法務の決定が要る。**実装着手前に確定が必要。**

- VOICEVOX 同梱＋自動起動（[`adr/0005`](adr/0005-voicevox-bundling.md) 残）・FFmpeg 同梱/バージョンpin/Windows N（#119/#120）・最終フォント選定・標準BGM/装飾の権利台帳。
- **クレジットの分類（旧A2を是正）**: ソフト利用クレジットと成果物クレジットを混同しない。

| 種類 | 表示場所 | ON/OFF | 担当 |
|---|---|---|---|
| ソフト利用クレジット（FFmpeg/フォント等） | アプリ About ＋配布物の LICENSE/THIRD_PARTY_NOTICES | 基本OFF不可・**動画には焼かない** | About表示は実装済／**ライセンス本文の同梱＝C群 packaging** |
| 出力動画内クレジット（VOICEVOX:ずんだもん） | 末尾場面/帯 | **規約次第** | **VOICEVOX規約読了＋運用決定後**に実装 |
| 任意の社内クレジット | 動画内 | ユーザー設定可 | 任意機能 |

- 設計原則: **法的に必須のクレジットは静かにOFFできない**（必須なら強制 or OFF時に代替表示を要求）。自由ON/OFFは任意社内クレジットのみ。

---

## 推奨着手順

**A1 →（要レビュー）B0/B1 → B2 → B3〔PNGレビュー→ユーザー承認→golden〕(Workflow) → B4 → B5 → B6 → A3**

クレジット（旧A2）は **C群の規約・運用決定とセットで別途**。
