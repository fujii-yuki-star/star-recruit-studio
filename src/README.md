# src — フロントエンド構成

このディレクトリは [`CLAUDE.md §4`](../CLAUDE.md) の責務別レイヤリングに従う。**依存方向**：`app` / `renderer` → `domain` ←（インターフェース越し）`infrastructure`。`domain` は他層に依存しない純粋ロジック。

| ディレクトリ | 責務 | 例 |
|---|---|---|
| `app/` | UI層（技術用語を出さない）。`screens` / `components` / `hooks` | 作成ウィザード、シーン編集画面 |
| `domain/` | 純粋ドメイン（副作用なし・テスト容易）。`project/asset/scene/part/template/voice/render/ai` | AI出力検証、`ai-video-plan`→Scene変換、ID採番、音量ミックス計算 |
| `infrastructure/` | 差し替え可能な外部連携。`fileSystem/ffmpeg/voicevox/aiProviders` | FFmpeg呼び出し、VOICEVOX連携、AiProvider(初期Mock) |
| `renderer/` | `preview`（高速プレビュー）/ `export`（本番MP4）。ADR-0001（A2ハイブリッド）に従う | 静止レイヤーのPNG化、FFmpeg合成 |
| `utils/` | 汎用ユーティリティ | — |

- エントリは `main.tsx`（Vite慣習で `src/` 直下）。既定の `App.tsx` は雛形UIで、本実装のUIは `app/` 配下に作る。
- enum・定数は直書きせず `domain` の定数（[`11_SCHEMA_REFERENCE.md §3,§4`](../docs/yuko_recruit_docs/11_SCHEMA_REFERENCE.md) 由来）を参照（`CLAUDE.md §6`）。
- 検証・変換・計算は純粋関数にして自動テスト（[`14_TEST_STRATEGY.md`](../docs/yuko_recruit_docs/14_TEST_STRATEGY.md)）。
