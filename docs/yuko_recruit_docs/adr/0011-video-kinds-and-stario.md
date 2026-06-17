# ADR-0011: 動画の用途拡張（採用／一般・社内発表の2系統）と製品名 stario

- **状態**: Proposed
- **日付**: 2026-06-17
- **関連**: `CLAUDE.md §1`（プロダクト一行）/ `01_*`（製品概要）/ `11 §3`（enum）・`11 §7`（project 構造）/ `12 §4–§6`（AI 入力・プロンプト）/ `schemas/project.schema.json`・`schemas/ai-video-plan.schema.json` / [`0003`](0003-narration-voice.md)（ゆうこ＝ナレーター）/ [`0010`](0010-real-ai-provider.md)（実 AI プロバイダ）

---

## コンテキスト

当初は**採用動画専用**（「ゆうこ採用ムービーメーカー」）だったが、運用方針が変わり、**社内発表など一般用途の動画**も作成対象に拡大することが決定した。あわせて**正式名称が「すたりお（stario）」**に決定した（会社名 star にあやかる）。

要件：
- 既存の**採用・会社紹介フローはそのまま温存**し、**拡張版**として一般動画も作れるようにする。
- 一般動画では**会社の採用情報（募集職種・求める人物像など）は不要**。用途に応じてウィザードと AI 入力を**分岐**させたい。
- 描画（テンプレ駆動）・プレビュー・書き出し・ナレーション（ゆうこ）など**共通部分は最大限再利用**したい。

実 AI 生成（[ADR-0010](0010-real-ai-provider.md)）は P1 として実装済みで、入力アセンブリ（`12 §4/§6`）と出力契約（`ai-video-plan`）が整っている。本 ADR はその上に「用途（種類）」という軸を足す。

## 決定の判断軸

1. **既存（採用）の後方互換・温存**（回帰を出さない）。
2. **共通基盤の最大再利用**（描画・テンプレ・声・`ai-video-plan` 出力契約）。
3. **用途ごとに最適な入力・プロンプト**（一般に採用前提の項目を残さない）。
4. **正典との整合・段階的移行**（docs-first。マイグレーション容易）。

## 検討した選択肢

### 選択肢A: `videoKind` 軸を新設して分岐【採用】
- 概要: `project.videoKind`（recruit / general）を最上位に新設。ウィザード最初で選び、以降の入力と AI プロンプトを種類ごとに切替。出力（`ai-video-plan`）・描画・テンプレは共通。
- 利点: 採用フロー温存（後方互換）。共通基盤を再利用。用途ごとに入力/プロンプトを最適化。拡張（種類追加）が容易。
- 欠点: 分岐の実装（ウィザード・プロバイダ・スキーマ）が要る。

### 選択肢B: `purpose` enum に一般用の目的を足すだけ
- 概要: 軸を増やさず、既存 purpose に一般動画の目的を追加。
- 利点: 実装が軽い。
- 欠点: `companyInfo` など**採用前提の入力が一般動画にも残り**、分岐が弱い。UI/プロンプトが用途に合わない。不採用。

### 選択肢C: 採用と一般を完全に別フロー／別アプリ化
- 概要: 用途ごとに独立した導線・データ。
- 利点: 各用途を個別最適化しやすい。
- 欠点: 共通基盤（描画・テンプレ・声・出力契約）の再利用が薄れ、保守コスト増。不採用。

## 決定

> **選択肢A を採用。** `videoKind`（recruit / general）で分岐する2系統に拡張し、製品名を **すたりお（stario）** とする。

### データ（`project.schema.json` / `11`）
- **`project.videoKind`**: `'recruit' | 'general'` を新設。**省略時は `recruit` 既定**（既存 project.json の後方互換＝マイグレーション容易）。
- **recruit（既存温存）**: `companyInfo`（会社名・業種・事業内容・募集職種・採用対象・強み・求める人物像・採用ページ・additionalNotes）＋ 採用 `purpose`（company_intro / new_graduate / mid_career / inexperienced_welcome / engineer / info_session / sns_short）。
- **general（新規）**: **`generalBrief`**（`title`/テーマ・`agenda: string[]`/章立て・`keyPoints: string[]`/要点）＋ 一般 `purpose`（種別）：**general_announcement（社内発表・全社共有）/ report（業績・活動報告）/ product_intro（製品・サービス紹介）/ general_other（汎用・その他＝当てはまらない動画の受け皿）**。
- **共通**: `targetAudience`・`tone`・`targetDurationSec`・`assets`(＋説明/タグ)・`additionalNotes`（自由記述）・声（ゆうこ/VOICEVOX）。

### ウィザード（`app`）
- 最初に**種類（recruit / general）を選択** → 分岐。
  - recruit: 目的 → 会社情報 → 素材 → 声 → 生成（現行のまま）。
  - general: 種別 → テーマ → 構成（章立て）→ 要点 → 対象・トーン → 素材 → 声 → 生成。

### AI（`12` / `infrastructure`）
- `videoKind` で **system プロンプト（§5 recruit ／ 新設 §5b general）** と **ユーザーメッセージ（§6 ／ 新設 §6b general）** を切替。
- general の system プロンプトは「会社紹介」ではなく「**発表・説明の構成案**」を作る指示にし、`generalBrief`（テーマ／章立て／要点）から parts/scenes を組む。会社情報の制約（templateId/asset/null 化・尺・表情タグ）等の**共通ルールは踏襲**。
- 出力は**同じ `ai-video-plan`**（出力契約・ajv 検証・`transformVideoPlan` は共通）。一般 purpose の出力での扱い（採用 enum との統合 or 併存）は `12 §3/§8` ＋ `ai-video-plan.schema.json` で確定（未解決#1）。

### テンプレート
- **既存カテゴリを一般にも流用（MVP）**：opening / closing / point_list / message / chapter / full_visual などは発表動画に適する。**発表専用テンプレの新設は将来**。

### ゆうこ・製品名
- **ゆうこ（マスコット／ナレーター）は両用途で継続使用**（[ADR-0003](0003-narration-voice.md) 準拠）。
- **製品名＝すたりお（stario）**。まず**資料（正典）＋アプリ表示名**を改称。**内部識別子（package.json/Cargo の name・リポジトリ名）は段階的に後追い**（破壊的変更を避けるため）。

## 結果・影響

- 既存の採用フロー・データは**後方互換**（`videoKind` 省略＝recruit。回帰なし）。
- **正典更新（docs-first・本 ADR をアンカーに）**：
  1. `01_*` / `CLAUDE.md §1`（製品スコープ＝2系統＋名称 stario）／ **`06_UI_SPEC §3`・`16_GLOSSARY`（`videoKind` の表示名を登録。例 recruit=「採用動画」・general=「一般動画・社内発表」＝§2-3 で技術語を UI に出さない）**。
  2. `11 §3`（`videoKind` enum・一般 purpose enum・`project.purpose` の設計）＋ `11 §7`（`generalBrief`・**`companyInfo` の条件付き必須化**・`additionalNotes` の帰属）／ `schemas/project.schema.json`（`videoKind`・`generalBrief`・一般 purpose・**`companyInfo` を `videoKind=recruit` のときのみ必須に**）。
  3. `12`（**§4 入力アセンブリ方針の本文を一般用途向けに更新**＝会社情報経由前提の記述を `videoKind` 分岐へ・§5b/§6b の新設・`videoKind` で入力アセンブリ分岐）／ `schemas/ai-video-plan.schema.json`（出力 `videoPlan.purpose` の一般値の扱い）。
- **実装（資料確定後）**：`domain`（`videoKind` 型・`generalBrief`・入力アセンブリの分岐を純粋関数化＋テスト）／`infrastructure`（プロバイダのプロンプト切替）／`app`（ウィザード分岐 UI）／stario 改称（docs/UI）。
- 描画・書き出し・声・`ai-video-plan` 出力契約は**無改修で流用**。

## 未解決の論点

1. **🔴 `companyInfo` の必須性**: 現行 `schemas/project.schema.json` は `companyInfo` を required、`11 §7.1` も必須（●）。`videoKind=general` では会社採用情報は不要なため、**条件付き必須**にする（`videoKind=recruit` のときのみ必須＝schema の `if/then/else`、または `companyInfo` を任意化して `11 §7.1` の表を更新）。正典更新②で確定（放置すると「general なのに companyName 必須」の矛盾）。
2. **`purpose` enum の設計（出力・内部の両方）**: ①AI出力 `videoPlan.purpose` と ②内部 `project.purpose`（現状 採用7種・**必須**）の双方で、採用 enum と一般 enum を**統合するか `videoKind` で別管理するか**を確定。`project.purpose` は必須フィールドゆえ設計の核心（一般時に `general_*` を入れるなら enum 拡張、別管理なら `purpose` を `videoKind=recruit` 限定にする等）。`11 §3.1` / `12 §3/§8` ＋ 両 schema で確定。
3. **`additionalNotes` の帰属先**: 現状 `companyInfo` 配下（`11 §7.1.2`）。両用途共通にするため **project トップレベルへ移すか、`generalBrief` 配下に持つか**を確定（recruit の既存データへの影響＝マイグレーションも考慮）。
4. **`generalBrief` の詳細**: `agenda`/`keyPoints` の要素数・文字数上限・必須/任意。
5. **UI 表示名（§2-3）**: `recruit`/`general` は技術識別子のため通常UIに出さない。`06_UI_SPEC §3` / `16_GLOSSARY` に表示名を登録（例 recruit=「採用動画」・general=「一般動画・社内発表」）。正典更新①で対応。
6. **`rewriteNarration` プリセット（`12 §10`）**: 現行プリセット（「若手向けに」等）は採用特化。一般用途では**共通化/分岐/一部無効化**を決める（当面は `videoKind=recruit` 限定として明示）。
7. **一般の few-shot（§7b）**: 一般動画の出力例と `targetDurationSec` の目安。
8. **発表専用テンプレ**: MVP は既存流用。将来タイトルスライド/箇条書き/章区切り等を新設するか。
9. **stario 内部識別子**: package/Cargo/リポジトリ名の改称タイミング（破壊的変更の扱い）。
10. **ゆうこの口調**: 一般・社内発表でトーンを調整するか（フォーマル寄せ等）。
11. **schemaVersion バンプ＋マイグレーション**: 本変更が `11 §1` の互換性方針で **major / minor どちらか**を確定（`videoKind`・`generalBrief` の追加は後方互換＝マイナー寄り。ただし `additionalNotes` を `companyInfo` 外へ移すなら構造変更＝メジャー相当）。`schemas/project.schema.json` の `schemaVersion`（現 `const "1.0"`）の扱い（`"1.1"`/`"2.0"` へのバンプ要否と ajv の const 検証）、既存 `project.json` への `videoKind` 既定付与・`additionalNotes` 移動の**マイグレーション実装方針**を決める（`11.1`）。
