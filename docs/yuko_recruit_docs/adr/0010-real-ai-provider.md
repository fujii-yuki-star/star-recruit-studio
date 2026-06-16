# ADR-0010: 実 AI プロバイダ（Gemini／OpenAI）と APIキー・外部送信の扱い

- **状態**: Proposed（2026-06-16・未レビュー。develop マージ＝レビュー通過で Accepted へ。実装は本ADR確定後）
- **日付**: 2026-06-16
- **関連**: `CLAUDE.md §2-2`（AI出力は検証してから内部へ）/ `§2-6`（外部送信は事前確認必須・元動画は送らない・代表フレームのみ）/ `§3`（Provider 抽象化・初期 Mock）/ `§4`（infrastructure に隔離）/ [`12_AI_PROMPT_AND_MAPPING.md`](../12_AI_PROMPT_AND_MAPPING.md)（プロンプト/マッピングの正典）/ `11 §8`（検証 V1–V11）/ [`13_DEPENDENCIES_AND_LICENSING.md`](../13_DEPENDENCIES_AND_LICENSING.md) `§7`（APIキー保管）/ [`15_ERROR_STATE_MODEL.md`](../15_ERROR_STATE_MODEL.md) `§6`（`AI_RESPONSE_INVALID` 等）/ `schemas/ai-video-plan.schema.json`

---

## コンテキスト

現状 AI は `MockAiProvider`（固定サンプルを返す）で全フローを通している（`AiProvider.generateVideoPlan(input) → AiVideoPlan`）。本ADRは**実 AI プロバイダ**への接続を設計する。利用者方針（確認済み）:
- **MVP は Gemini API**（予算配慮・無料枠を使用）。将来 **OpenAI API**。
- **両プロバイダ（Gemini / OpenAI）の実装をソフトに用意**し、設定で選べるようにする。
- **APIキーは利用者が用意**（利用者の鍵で接続）。

不変条件（崩さない）: **AIは動画を生成しない**（構成JSON `ai-video-plan` を返すだけ・§2-1）。**AI出力は検証してから内部 Scene へ変換**（§2-2／12§8／11§8）。**外部送信は事前確認必須・元動画/元ファイルは送らない**（§2-6）。**通常UIに技術用語を出さない**（§2-3）。

既存の土台: `reqwest`（Cargo 導入済み・`voicevox.rs` で使用）／`ai-video-plan.schema.json`＋`transformVideoPlan`（検証/変換）／`12` のプロンプト正典。**OSキーチェーン用のクレートは未導入**。

## 検討した選択肢

### A. API 呼び出しをどこで行うか
- **(A1) Rust（reqwest）で呼ぶ。フロントは Tauri コマンド経由**【採用】: APIキーを Rust／OSキーチェーンに留め、**WebView(JS) に鍵を出さない**（§13§7）。`voicevox.rs` と同じ reqwest パターンを流用。
- (A2) フロント（fetch）で直接呼ぶ — 鍵が JS メモリに乗る・CORS 依存。§13§7 のセキュリティ方針に劣る。不採用。

### B. APIキーの保管
- **(B1) OSキーチェーン（Rust `keyring` クレート）**【採用】: Windows 資格情報マネージャ等に保存（§13§7）。`project.json`／設定ファイルに**平文保存しない**・ログ/コミット禁止。
- (B2) 設定ファイルに平文/簡易暗号 — §13§7 違反。不採用。

## 決定

> **A1＋B1 を採用。** `AiProvider` 抽象の実装として **GeminiProvider（MVP）** と **OpenAIProvider（準備）** を用意し、**設定でプロバイダを選択**。APIキーは**利用者が設定画面で入力→OSキーチェーン保管**。**API 呼び出しは Rust（reqwest）**で行い鍵を JS に出さない。**送信前に確認画面**を通し、**会社情報＋素材の説明（テキスト）**のみ送る（元ファイル・元動画は送らない）。応答 JSON は**検証（ajv＋transformVideoPlan）→ 不正なら手動フォールバック**。

### プロバイダ
- `infrastructure/aiProviders/geminiProvider.ts`（MVP）／`openAiProvider.ts`（準備）。いずれも `AiProvider` 実装。
- これらは `GenerateVideoPlanInput` から **12 のプロンプトを組み立て**（プロンプト生成は `domain` の純粋関数に切り出し＝§7 テスト対象）、**Tauri コマンド `ai_generate`**（provider 種別＋組み立て済みリクエスト本文）を invoke して応答テキストを得る。
- 既定／フォールバックは `MockAiProvider`（鍵未設定・オフライン・非Tauri 時）。**MVP は「鍵があれば実プロバイダ、無ければ Mock」**で全フロー継続。

### Rust 側（`ai.rs` 新設・reqwest）
- コマンド: `ai_generate(provider, model, body) -> String`（応答テキスト）／`save_api_key(provider, key)`／`has_api_key(provider) -> bool`／`delete_api_key(provider)`。
- 鍵は `keyring` クレートでサービス名＝アプリ識別子・アカウント＝provider 名で保存。**鍵はフロントへ返さない**（`has_api_key` で有無のみ）。
- Gemini/OpenAI の REST を reqwest で叩き、**構成JSON（`ai-video-plan`）を「JSON モード／schema 指定」で要求**（Gemini: `responseMimeType: application/json`、OpenAI: `response_format: json_object`）。

### データポリシー（§2-6・最重要）
- 送るのは **会社情報（`companyInfo`）＋目的＋素材の説明（`displayName`/`tags`/`aiDescription`）＋テンプレ要約＋ゆうこ poseTag**。**素材ファイル・元動画・base64 は送らない**。
- **MVP はテキストのみ**（代表フレーム画像は送らない）。代表フレーム送信は将来（§2-6 の「代表フレームのみ」に沿って拡張可能・要再確認）。
- **送信前確認**: 生成実行前に「これらの情報を外部AI（プロバイダ名）に送ります」と**送信内容の要約を提示して確認**を取る（§2-6）。既存の確認/生成導線に確認ステップを差す。

### 生成フロー（既存検証を流用）
1. `GenerateVideoPlanInput` →（domain 純粋）プロンプト生成。
2. Provider が `ai_generate` を invoke → 応答テキスト（JSON 文字列）。
3. **ajv で `ai-video-plan.schema.json` 検証**（V1,V2）→ パース。
4. `transformVideoPlan`（V3–V11・補正→warnings）→ 内部 Scene。
5. 失敗（パース不可・schema 不一致・API エラー）→ `AI_RESPONSE_INVALID`／ネットワーク系エラーを §2-5 文言で表示し、**再生成 or 手動で続行**（12§9.3・15§6）。`ai/latest_result.json` 退避は任意。

### 設定 UI（§2-3）
- 設定画面に「AI の接続」セクション: **プロバイダ選択**（自動でずんだもん…ではなく「Gemini / OpenAI」だが、表示は技術語を避けつつ製品名は可）＋**APIキー入力**（保存で keyring へ・保存済みは「設定済み」表示で値は出さない）＋接続テスト（任意）。
- プロバイダ選択は**アプリ全体設定**（鍵は利用者単位）。project.json には鍵もプロバイダ鍵も入れない。

### 段階分割
- **P1**: `keyring` 依存追加／`ai.rs`（save/has/delete key・`ai_generate`）／GeminiProvider（プロンプト生成＝domain 純粋＋テスト・Rust 経由呼び出し）／設定UI（鍵入力・保存）／**送信前確認**／検証・フォールバック。鍵が無ければ Mock。
- **P2**: OpenAIProvider（同抽象・設定でプロバイダ切替）。
- **P3**: 代表フレーム送信（任意・§2-6）／リトライ・レート制限の UX／`rewriteNarration` 等の追加メソッド（12§2）。
- 各段で typecheck/lint/test/cargo 緑・ブラウザ/`tauri dev` 動確。鍵を要する実呼び出しの E2E は利用者鍵＋tauri dev。

### 依存・正典更新
- **`keyring` クレート追加**（OSキーチェーン）。`13 §7`／§9 チェックリストに反映。reqwest は既存流用。
- `12` のプロンプト実体・出力契約（JSON モード）に追補が要れば正典として更新。

## 結果・影響

- `MockAiProvider` は残し、**鍵未設定/オフライン/非Tauri のフォールバック**として全フロー継続（回帰なし・テストも Mock 前提を維持）。
- 鍵は **OSキーチェーンのみ**（平文ファイル無し）。フロントは鍵の値を保持しない。
- 外部送信は**テキストのみ＋送信前確認**。元動画・元ファイルは送らない（§2-6 厳守）。
- `domain` にプロンプト生成（純粋・テスト）。`infrastructure/aiProviders` に Provider 実装。`src-tauri` に `ai.rs`（reqwest＋keyring）。

## 未解決の論点

1. **モデル名／無料枠制限**: Gemini の使用モデル（無料枠で使えるもの）と OpenAI のモデル。レート/トークン上限時の扱い（要約・分割）。
2. **「ソフト側でも用意」の解釈**: 本ADRは「**両プロバイダ実装を同梱・鍵は利用者入力**」と解釈。アプリが共有鍵を持って費用負担する方式は配布/コスト上 MVP では採らない（要確認）。
3. **代表フレーム送信**: MVP はテキストのみ。将来 §2-6 の代表フレーム送信を足すか（画像対応モデル前提）。
4. **トークン超過**: 素材/会社情報が大きいときのプロンプト要約戦略。
5. **接続テスト UI** の要否（鍵保存時に1回叩いて検証するか）。
6. **`ai/latest_result.json` 退避**（12§9.3）の MVP 採否。
