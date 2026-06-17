# CLAUDE.md — すたりお（stario）AI開発ガイド

> このファイルは Claude Code が自動読込する、本リポジトリの**AI開発の正典（規約）**です。
> Codex・Cursor 等の他AIツールを使う場合も、**作業開始前に必ずこのファイルを最初に読むこと。**
> 本プロジェクトは「AI駆動開発」を前提とする。曖昧さはAIの推測を招くため、**規範（normative）と例示（example）を厳密に区別**する。

---

## 0. 資料の地図と「正典」の優先順位

| 区分 | ファイル | 性質 |
|---|---|---|
| 製品・要件 | `docs/yuko_recruit_docs/01`〜`10` | 解説・背景（example混在） |
| **データ規範** | `docs/yuko_recruit_docs/11_SCHEMA_REFERENCE.md` ＋ `docs/yuko_recruit_docs/schemas/*.schema.json` | **正典** |
| **AI規範** | `docs/yuko_recruit_docs/12_AI_PROMPT_AND_MAPPING.md` | **正典** |
| AI開発規約 | `CLAUDE.md`（本ファイル） | **正典** |

**矛盾したときの優先順位：`schemas/*.schema.json` ＝ `11` ＝ `12` ＝ `CLAUDE.md` ＞ `01`〜`10`。**
`03_DATA_SCHEMA.md` と `07_AI_SPEC.md` の JSON は**理解のための例示**であり、フィールドの型・必須・enum・制約の正典は `11` と `schemas/` にある。

---

## 1. プロダクト一行

> 利用者が情報（採用なら会社情報、一般なら発表テーマ等）と写真・動画を入力すると、AIが**動画構成JSON**とゆうこのセリフを生成し、ソフトが**テンプレート（見た目パターン）に沿って機械的に**動画を組み立て、プレビューとMP4出力ができるWindows向け動画制作支援ソフト「**すたりお（stario）**」。**採用・会社紹介に加え、社内発表など一般動画も作成できる**（用途は `videoKind`＝採用 / 一般・社内発表 で分岐＝ADR-0011）。

---

## 2. 絶対原則（不変条件・違反禁止）

1. **AIは動画を生成しない。** AIは動画構成JSON（`ai-video-plan`）を返すだけ。映像合成はソフトが行う。
2. **AI出力は必ず検証してから内部データへ変換する。** 生検証なしに `project.scenes` へ流し込まない（→ `11.8` / `12.8`）。
3. **通常UIに技術用語を出さない。** `JSON / FFmpeg / LLM / Provider / templateId / assetId / レンダリング / バリデーション` 等は表示禁止。置換語は `06_UI_SPEC.md §3`。
4. **テンプレート駆動。** 座標・配置はテンプレートが決める。ユーザーに毎回座標を触らせない。
5. **エラーは「原因」でなく「次の行動」を示す。** 例: `Invalid templateId` ❌ →「見た目パターンが見つからないため標準を使います」⭕。エラー・状態の正典は [`15_ERROR_STATE_MODEL.md`](docs/yuko_recruit_docs/15_ERROR_STATE_MODEL.md)。
6. **外部送信は事前確認必須。** 元動画ファイルは送らない（代表フレームのみ）。送信前確認画面を必ず通す。
7. **数値・enum・IDはハードコードしない。** 正典（`11.3` enum / `11.4` 定数）を単一の参照元とし、定数モジュール経由で使う。

---

## 3. 技術スタック（baseline）

| 領域 | 採用（baseline） | 備考 |
|---|---|---|
| デスクトップ | **Tauri** | Windows優先 |
| UI | **React + TypeScript** | strict |
| 状態管理 | Zustand（軽量） | 変更可 |
| 保存 | ローカルJSON（プロジェクトフォルダ） | `11.1` |
| 動画処理 | **FFmpeg** | 同梱可否/ライセンスは**未決定**（§11） |
| 音声合成 | **VOICEVOX**（既定ずんだもん） | 同梱/規約は**未決定**（§11） |
| 外部AI | Provider抽象化（初期 **MockProvider**） | OpenAI/Claude/Gemini/Ollama |
| 描画一致方式 | **未決定（ADR必須）** | プレビューと本番出力の一致（§11・論点③） |

> baseline は `09_CODEX_IMPLEMENTATION_PROMPT.md` の構成を**確定**したもの。変更する場合は ADR（§11）を残す。

---

## 4. アーキテクチャ / ディレクトリ責務

```text
src/
  app/            UI（screens / components / hooks）。技術用語を出さない層
  domain/         純粋ドメイン（project/asset/scene/part/template/voice/render/ai）。副作用なし・テスト容易
  infrastructure/ 差し替え可能な外部連携（fileSystem/ffmpeg/voicevox/aiProviders）
  renderer/       preview（高速プレビュー）/ export（本番MP4）
  utils/
```

**依存方向ルール**
- `domain` は他層に依存しない（純粋関数中心。検証・変換・音量計算・テキスト計測はここ）。
- `app`（UI）と `renderer` を分離する。`renderer/preview` と `renderer/export` も分離する。
- 外部I/O（FFmpeg・VOICEVOX・AI・FS）は `infrastructure` に隔離し、`domain` からはインターフェース越しに使う。
- `AiProvider` / `VoiceProvider` は必ず抽象化し、まず Mock 実装で全フローを通す（`09 §6`）。

---

## 5. データの正典と不変条件

- 全永続データは JSON。正典スキーマは `docs/yuko_recruit_docs/schemas/`。
  - `project.schema.json` … `project.json`（Asset/Part/Scene を `$defs` で内包）
  - `template.schema.json` … テンプレ定義（見た目パターン）
  - `ai-video-plan.schema.json` … **AI出力**（内部 Scene とは別物）
- データの流れ（厳守）: `AI出力(ai-video-plan)` → **検証** → **自動補正** → **変換（マッピング）** → `内部 Scene/Part`。詳細は `12`。
- **ID採番**（`11.2`）: `part_NNN` / `scene_NNN` / `asset_*`。3桁ゼロ詰め・プロジェクト内一意。
- **null = 継承**。`scene` の声・音量フィールドが null のとき project 既定を継承（解決順序は `11.6`）。
- `schemaVersion` は3スキーマで独立。破壊的変更時はマイグレーションを用意（`11.1`）。

---

## 6. コーディング規約

- TypeScript: `strict: true`。`any` 禁止（やむを得ない場合は理由コメント）。公開関数は型注釈必須。
- enum値・定数は**文字列リテラル直書き禁止**。`domain` 内の定数/型（`11.3`/`11.4` 由来）を参照。
- 関数は副作用と純粋ロジックを分ける。検証・変換・計算は純粋関数にしてテストする。
- 命名: ファイル `camelCase.ts`、React コンポーネント `PascalCase.tsx`、型 `PascalCase`、定数 `UPPER_SNAKE`。
- ユーザー向け文言は1か所（i18n/文言定義）に集約し、コード内に技術語の生文字列を散らさない。
- コメント・UI文言は日本語、コード識別子は英語（既存資料の流儀に合わせる）。

---

## 7. テスト方針 / Definition of Done

> 自動テストの詳細戦略・仕様→テストのカタログは [`14_TEST_STRATEGY.md`](docs/yuko_recruit_docs/14_TEST_STRATEGY.md)。

- **必ず自動テストを書く対象（純粋ロジック）**: AI出力の検証、`ai-video-plan`→`Scene`変換、ID採番、poseTag解決、durationのclamp、音量ミックス計算、テキスト折返し・あふれ判定。
- **golden-file テスト**: テンプレ＋シーンからのプレビュー配置・出力。サンプル（`fixtures`、別途作成予定 F）を期待値とする。
- **スキーマ検証テスト**: `schemas/*.schema.json` に対し代表データ（正常・異常）を ajv 等で検証。
- DoD: ①該当テストが緑 ②型エラー/lintなし ③UIに技術用語が漏れていない ④正典（11/12/schemas）と矛盾しない ⑤ユーザー向けエラー文言が「次の行動」を示す。

---

## 8. コミット / 進め方

- 小さく、必ず動く単位でコミット（`09 §9`）。Conventional Commits 推奨（`feat: / fix: / docs: / refactor: / test:`）。
- 実装順は `02_MVP_ROADMAP.md` の Phase 0→6、初手の粒度は `09 §4`（Mock先行・プレビュー先行）に従う。
- 大きな設計判断は ADR（`docs/yuko_recruit_docs/adr/`）に残してからコードを書く。

---

## 9. AIエージェントの作業方針（重要）

1. **着手前に `11` と `12` を読む。** 例示（03/07）だけを見て実装しない。
2. **未定義に出会ったら推測で埋めない。** 正典に無い仕様は、ユーザーに確認するか ADR を提案する。勝手にenumやフィールドを増やさない。用語・enumは [`16_GLOSSARY.md`](docs/yuko_recruit_docs/16_GLOSSARY.md) と `11 §3` を参照。
3. **正典 > 例示。** `03`/`07` の例と `11`/`12`/`schemas` が食い違う場合は後者に従い、矛盾を報告する。
4. **技術用語UI漏れの自己チェック**を毎回行う（原則§2-3）。
5. 破壊的変更（既存資料の大改修・削除）は理由を述べてから行う。

---

## 10. MVPでやらないこと

本格タイムライン編集 / キーフレームアニメ / 3D・Live2D / 複雑エフェクト / テンプレート作成エディタ / 縦・正方形動画 / 全Provider対応 / AIによる映像生成 / 口パクアニメ。（`01 §16.2`・`09 §8`）

---

## 11. 主要な設計判断（ADR）と未決定事項

**決定済み（ADR）**
- 描画一致方式（論点③）: [`adr/0001`](docs/yuko_recruit_docs/adr/0001-rendering-parity.md) **Accepted** — 方式A2ハイブリッド。`05_RENDERING_SPEC.md` 追従改訂済み。
- FFmpeg/コーデック: [`adr/0002`](docs/yuko_recruit_docs/adr/0002-ffmpeg-codec.md) **Accepted** — LGPLビルド＋OpenH264（**自前の特許ライセンス不要**）。
- ナレーション音声: [`adr/0003`](docs/yuko_recruit_docs/adr/0003-narration-voice.md) **Accepted** — VOICEVOX:ずんだもんを**ナレーター**として使用（ゆうこ固有の声とは称さない）＋常時クレジット。
- VOICEVOX同梱: [`adr/0005`](docs/yuko_recruit_docs/adr/0005-voicevox-bundling.md) **Accepted** — エンジンを**同梱しアプリ起動時に自動起動**（接続先設定は上級者向けフォールバック）。規約確認済み・クレジット表示は維持。実装/配布の詳細は ADR 未解決論点。
- ゆうこ＝自社保有で権利クリア（`17`）／フォントはOFL系を同梱（游ゴシック等は同梱不可。`13 §6`）。

**未決定（リリース前に確認）**
> 全体整理は [`13_DEPENDENCIES_AND_LICENSING.md`](docs/yuko_recruit_docs/13_DEPENDENCIES_AND_LICENSING.md) §9 チェックリスト。
- FFmpeg の正確なビルド構成・Cisco OpenH264 バイナリ取得方式（`adr/0002`）。
- APIキー保管の実装（OSキーチェーン、`13 §7`）／最終フォント選定（OFL系）。
- 標準BGM・装飾アセットの入手元とライセンス。（正式プロダクト名は **すたりお（stario）** に決定済み＝ADR-0011）
