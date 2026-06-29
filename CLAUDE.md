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
4. **テンプレート駆動。** 座標・配置はテンプレートが決める。**通常の場面編集ではユーザーに毎回座標を触らせない**。座標を直接編集するのは **FREE（自由配置）場面**と**テンプレート作成エディタ**（見た目パターンの作成・編集＝ADR-0017）に限定する。
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
| 動画処理 | **FFmpeg** | LGPL＋Media Foundation(`h264_mf`)＝ADR-0002/0013（実機検証済）。配布形態は§11 |
| 音声合成 | **VOICEVOX**（既定ずんだもん） | 同梱＝ADR-0005（ENGINE を同梱・規約根拠も記録済＝#122）／ENGINE 同梱実装＝#149 |
| 外部AI | Provider抽象化（初期 **MockProvider**） | OpenAI/Claude/Gemini/Ollama |
| 描画一致方式 | **ADR-0001（A2ハイブリッド）** | プレビューと本番出力の一致（§11・論点③） |

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

本格タイムライン編集 / キーフレームアニメ / 3D・Live2D / 複雑エフェクト / 正方形（1:1）動画 / 全Provider対応 / AIによる映像生成 / 口パクアニメ。（`01 §16.2`・`09 §8`）

> ※ **テンプレート作成エディタ**は当初 MVP 除外だったが、利用者が見た目パターンを作る要件により**対応決定**（[`adr/0016`](docs/yuko_recruit_docs/adr/0016-detailed-editing-completion-roadmap.md)／[`adr/0017`](docs/yuko_recruit_docs/adr/0017-template-authoring-editor.md) **Accepted**・2026-06-27・EPIC #214）＝本項「テンプレート作成エディタ」除外を解除。**ゼロから作成も可（フル）**・ユーザーテンプレは**普通の Template**としてグローバル永続化し、AI/簡易/詳細・描画は既存経路を共有（`decor` レイヤーのみ非開放・AI 入力からは既定で除外）。

> ※ **縦型動画（9:16）**は当初 MVP 除外だったが、ユーザー要件により**対応決定**（[`adr/0012`](docs/yuko_recruit_docs/adr/0012-aspect-ratio-and-portrait.md) **Accepted**・2026-06-19・#118）＝本項の「縦型」除外を解除。**正方形（1:1）は引き続き MVP 外**（schema 枠のみ残す）。

> ※ **場面内のセリフ簡易タイミング**（`scene.lines` の `startSec` 調整・単一トラック）は、掛け合い（[`adr/0015`](docs/yuko_recruit_docs/adr/0015-dialogue-timeline-model.md) **Accepted**・2026-06-25・#180）により**対応決定**＝本項「本格タイムライン編集」除外を**この範囲に狭める**。**複数トラック・キーフレームアニメ・場面横断タイムラインは引き続き MVP 外。**

---

## 11. 主要な設計判断（ADR）と未決定事項

**決定済み（ADR）**
- 描画一致方式（論点③）: [`adr/0001`](docs/yuko_recruit_docs/adr/0001-rendering-parity.md) **Accepted** — 方式A2ハイブリッド。`05_RENDERING_SPEC.md` 追従改訂済み。
- FFmpeg/コーデック: [`adr/0002`](docs/yuko_recruit_docs/adr/0002-ffmpeg-codec.md) **Accepted** — FFmpeg は LGPLビルド＋動的リンク＋ソース提供。**H.264 エンコーダの選択は [`adr/0013`](docs/yuko_recruit_docs/adr/0013-h264-via-media-foundation.md) で更新**。
- H.264 書き出し: [`adr/0013`](docs/yuko_recruit_docs/adr/0013-h264-via-media-foundation.md) **Accepted** — **Media Foundation（`h264_mf`）主経路**（OS提供）。配布用 LGPL ビルド（BtbN win64-lgpl）に h264_mf 実在＋アプリ実書き出しを **Windows 実機で検証済＝自前ビルド不要**。OpenH264 はフォールバック。**配布パッケージング（#119・α は MSI 単独）・Windows N 検知（#120）・ビットレート最適化（#121）はいずれも実装済**。
- ナレーション音声: [`adr/0003`](docs/yuko_recruit_docs/adr/0003-narration-voice.md) **Accepted** — VOICEVOX:ずんだもんを**ナレーター**として使用（ゆうこ固有の声とは称さない）＋常時クレジット。
- VOICEVOX同梱: [`adr/0005`](docs/yuko_recruit_docs/adr/0005-voicevox-bundling.md) **Accepted** — エンジンを**同梱しアプリ起動時に自動起動**（接続先設定は上級者向けフォールバック）。規約確認済み・クレジット表示は維持。実装/配布の詳細は ADR 未解決論点。
- ゆうこ＝自社保有で権利クリア（`17`）／フォントはOFL系を同梱（游ゴシック等は同梱不可。`13 §6`）。
- 縦型動画（9:16・1080×1920）: [`adr/0012`](docs/yuko_recruit_docs/adr/0012-aspect-ratio-and-portrait.md) **Accepted**（2026-06-19）— α版に対応決定。**9:16のみ**（1:1は将来）・縦テンプレは**全9カテゴリ**・既存は**16:9固定移行＋向き変更（16:9⇆9:16）導線**・尺上限は横型踏襲。コーデックとは独立の別トラック（#118）。
- コンポーネント/対話テスト基盤: [`adr/0014`](docs/yuko_recruit_docs/adr/0014-component-test-foundation.md) **Accepted**（2026-06-25）— Vitest に jsdom を追加し `@testing-library/react`＋`jest-dom` を導入。**既定 environment は node 維持**・DOM が要る `*.test.tsx` のみファイル先頭 `// @vitest-environment jsdom` で個別切替（既存 node 純粋ロジックテストへ波及なし）。最小構成（happy-dom ではなく jsdom・user-event は当面見送り）。正典/schemaVersion 影響なし。
- テンプレ作成エディタ（ユーザーテンプレ）: [`adr/0017`](docs/yuko_recruit_docs/adr/0017-template-authoring-editor.md) **Accepted**（2026-06-27・EPIC #214）— 利用者が見た目パターンを**ゼロから作成/複製編集**できるフルエディタ（§10 緩和＝[`adr/0016`](docs/yuko_recruit_docs/adr/0016-detailed-editing-completion-roadmap.md)）。ユーザーテンプレ＝**普通の Template**（`user_tmpl_NNN`・グローバル永続化・`template.schema` 不変＝`11 §2.1`）。①の編集UXを流用、`decor` 非開放、**AI 入力からは既定で除外**。場面のテキスト欄はテンプレのテキスト層から生成（④b）。
- 場面横断タイムライン／複数トラック（③・**設計のみ**）: [`adr/0018`](docs/yuko_recruit_docs/adr/0018-cross-scene-timeline-model.md) **Proposed**（2026-06-28・α-3 ③／実装は α-4+）— **2モデル方式**：場面ベースを**正準**（AI 生成・場面編集）に維持しつつ、`compileTimeline(project)` で**時間軸＋トラック**へ機械射影し、書き出しと**専用タイムラインUI（別画面）**が共有。時間軸の自由編集は場面アンカーの任意オーバーレイ層に保存し AI/簡易は無視（推奨）。AI は場面のみ・**単一パイプライン維持**（ADR-0007 M-A）、場面は静止のまま（per-frame は④/`adr/0019`）。`§10`「完全自由タイムライン」を将来段階解除。
- キーフレーム／場面内アニメ（④・**設計のみ**）: [`adr/0019`](docs/yuko_recruit_docs/adr/0019-keyframe-animation-model.md) **Proposed**（2026-06-28・α-3 ④／実装は α-4+）— **ADR-0001 の選択肢C（毎フレーム Web 描画）を発火**＝`layoutScene(scene, template, t)` でキーフレーム補間したレイアウトをフレームごとに SVG→PNG。**パリティをフレーム単位で構造保証**（preview/export 同一）。キーフレームは ADR-0018 オーバーレイに格納（AI/場面正準は不変）。**アニメ無し場面は静止1枚を維持**（後方互換）。承認＋実装時に **`adr/0001` を supersede**（「場面内静止」制約のみ置換）。`§10`「キーフレーム」を将来段階解除（口パク・3Dは対象外）。
- テンプレ既定素材（template-owned default assets）: [`adr/0021`](docs/yuko_recruit_docs/adr/0021-template-owned-assets.md) **Accepted**（2026-06-29・α-3 追加・実装は EPIC サブPR A〜D）— テンプレが**既定素材（背景等）を持てる**。素材ファイルは**グローバル保存**（`user_templates/assets`・id=`tmpl_asset_NNN`）、`Layer.assetId`＋テンプレ `assets` マニフェストで参照。描画は **`scene.assetRefs[layer.id] ?? layer.assetId`**（場面素材が優先・テンプレ既定はフォールバック）。見本は持ち主写真の自動流し込みをやめる（①）。**ADR-0017 の「`template.schema` 不変／1テンプレ=1ファイル」を一部改める**（schema は任意追加で版据え置き＝`11 §1`／素材を持つテンプレは単一JSON共有不可＝bundle は将来）。

**未決定（リリース前に確認）**
> 全体整理は [`13_DEPENDENCIES_AND_LICENSING.md`](docs/yuko_recruit_docs/13_DEPENDENCIES_AND_LICENSING.md) §9 チェックリスト。
- ~~FFmpeg 配布パッケージング~~ → **実装済**：win64-lgpl-shared（動的リンク）を pin 同梱＋`FFmpeg_SOURCE.md`（ソース提供）＝#119／Windows N 検知＝#120／ビットレート最適化＝#121。α は **MSI 単独配布**（NSIS は ~2GB 同梱で不可）。
- フォント選定 → **初期3種を選定・同梱（#161・全 SIL OFL 1.1）**：gen-interface-jp（既定/本文）・gen-interface-jp-display（見出し）・怪盗予告ゴシック（演出）。**動画全体（`videoSettings.fontId`）＋場面ごと（`scene.fontId`・「動画全体に合わせる」で継承＝schema 1.5）**に選択可。追加は段階的。（※APIキーのOSキーチェーン保管は実装済＝ADR-0010／`13 §7`）
- 標準BGM → **実装済**：CC0 3曲（Open Music Academy）を同梱＋書き出しで選択（`public/bgm/`・`bgmSettings.bundledBgmId`＝schema 1.4・権利台帳 `13 §8.1`・About にクレジット）。装飾アセットは当面なし。（正式名 **すたりお（stario）**＝ADR-0011。**ウィンドウタイトル/About 表示＝「すたりお」**、**`productName`（インストーラ/アプリ名）＝ASCII の `stario`**＝WiX `light.exe` が日本語の MSI ファイル名で失敗するため。`identifier` 由来のデータパスは無影響）
