# すたりお（stario）設計資料セット

## 概要

本資料セットは、採用担当者向けPCソフト「すたりお（stario）」（旧称：ゆうこ採用ムービーメーカー）を開発するための要件・設計・実装補助資料です。

本ソフトは、AIが動画そのものを生成するのではなく、AIが動画構成案・パート構成・シーン構成・ナレーション・字幕・使用素材案をJSON形式で生成し、ソフト側がテンプレートに沿って機械的に動画を組み立てる方式を採用します。

## 資料一覧

| No | ファイル | 目的 |
|---:|---|---|
| 01 | `01_REQUIREMENTS.md` | 全体要件定義 |
| 02 | `02_MVP_ROADMAP.md` | MVP実装順序・フェーズ分割 |
| 03 | `03_DATA_SCHEMA.md` | project / asset / template / scene 等のJSON設計 |
| 04 | `04_TEMPLATE_SPEC.md` | 見た目パターン・テンプレートパック仕様 |
| 05 | `05_RENDERING_SPEC.md` | プレビュー・MP4出力・音声ミックス仕様 |
| 06 | `06_UI_SPEC.md` | 非技術者向け画面仕様 |
| 07 | `07_AI_SPEC.md` | AI機能・送信内容・出力JSON・バリデーション仕様 |
| 08 | `08_TEST_PLAN.md` | 受け入れ条件・テスト観点 |
| 09 | `09_CODEX_IMPLEMENTATION_PROMPT.md` | Codexへ渡す初期実装指示 |
| 10 | `10_USER_MANUAL_DRAFT.md` | 採用担当向け操作マニュアル草案 |
| 11 | `11_SCHEMA_REFERENCE.md` | **【正典】** データ規範・enum・定数・バインディング・解決順序 |
| 12 | `12_AI_PROMPT_AND_MAPPING.md` | **【正典】** AIプロンプト・構造化出力・AI出力→内部変換 |
| 13 | `13_DEPENDENCIES_AND_LICENSING.md` | 依存・ライセンス・配布（FFmpeg/VOICEVOX/ずんだもん/フォント/APIキー） |
| 14 | `14_TEST_STRATEGY.md` | 自動テスト戦略（08の手動観点を補完。仕様→テストのカタログ） |
| 15 | `15_ERROR_STATE_MODEL.md` | **【正典】** 状態遷移・部分失敗・排他・エラーコード語彙（Warning.code） |
| 16 | `16_GLOSSARY.md` | 用語集（ユーザー語⇄内部語、ドメイン用語、enum索引） |
| 17 | `17_YUKO_CHARACTER_SPEC.md` | ゆうこ素材仕様（形式・命名・表情セット。作画/権利/声は事業判断） |
| — | `schemas/*.schema.json` | **【正典】** project / template / ai-video-plan のJSON Schema実体 |
| — | `../../CLAUDE.md` | AI開発規約（全AIエージェント共通の行動規範・資料の地図） |
| — | `adr/` | アーキテクチャ決定記録（ADR）。重要な設計判断の根拠 |

## 正典と例示の区別（重要）

本資料群のうち、**`11` / `12` / `schemas/*.schema.json` / ルートの `CLAUDE.md` が「正典（normative）」**である。
`01`〜`10`（特に `03` の JSON と `07` の JSON）は**理解のための例示**であり、フィールドの型・必須・enum・制約・変換規則の最終的な根拠は正典側にある。
**矛盾した場合は正典を優先する。**

## 推奨の読み順

0. `../../CLAUDE.md`（AI開発規約・資料の地図）
1. `01_REQUIREMENTS.md`
2. `02_MVP_ROADMAP.md`
3. `03_DATA_SCHEMA.md`（例示）→ `11_SCHEMA_REFERENCE.md`（正典）＋ `schemas/`
4. `04_TEMPLATE_SPEC.md`
5. `05_RENDERING_SPEC.md`
6. `06_UI_SPEC.md`
7. `07_AI_SPEC.md`（例示）→ `12_AI_PROMPT_AND_MAPPING.md`（正典）
8. `09_CODEX_IMPLEMENTATION_PROMPT.md`
9. `08_TEST_PLAN.md`
10. `10_USER_MANUAL_DRAFT.md`

## 開発上の重要方針

- 主利用者は非技術者の採用担当者とする。
- 通常UIではJSON、FFmpeg、LLM、Providerなどの技術用語を見せない。
- AIは動画を直接生成しない。
- AIは動画構成JSONを生成する。
- ソフトはJSONを検証し、テンプレートに沿って機械的に動画化する。
- 最初は横動画16:9、将来的に最大10分動画を想定する。
- ゆうこはテンプレートごとに表示有無・位置が変わる。
- 画像サムネイルは外部AIへ送信してよい。
- 標準BGM同梱とユーザーBGM追加の両方に対応する。
- ゆうこの声はデフォルトずんだもん、将来的にゆっくりボイス等も選択可能にする。
