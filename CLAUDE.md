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
4. **テンプレート駆動。** 座標・配置はテンプレートが決める。**通常の場面編集ではユーザーに毎回座標を触らせない**。座標を直接編集するのは **FREE（自由配置）場面**と**テンプレート作成エディタ**（見た目パターンの作成・編集＝ADR-0017）に限定する。**時間軸（テロップ等の表示タイミング）の自由編集も通常の場面編集には出さず、専用の「タイムライン編集」画面に隔離する（ADR-0018・③(4)）。**
5. **エラーは「原因」でなく「次の行動」を示す。** 例: `Invalid templateId` ❌ →「この場面の見た目パターンが見つかりません。場面編集で選び直してください」⭕。**既存の場面**の見た目が後から解決できなくなったときは**黙って別の見た目に差し替えない**（作り込みが化けた動画を成功として出さない・#547／取り込み時の自動補正との使い分けは `15 §6`）。エラー・状態の正典は [`15_ERROR_STATE_MODEL.md`](docs/yuko_recruit_docs/15_ERROR_STATE_MODEL.md)。
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

> ※ **場面内のセリフ簡易タイミング**（`scene.lines` の `startSec` 調整・単一トラック）は、掛け合い（[`adr/0015`](docs/yuko_recruit_docs/adr/0015-dialogue-timeline-model.md) **Accepted**・2026-06-25・#180）により**対応決定**＝本項「本格タイムライン編集」除外を**この範囲に狭める**。**キーフレームアニメ（④）は [`adr/0019`](docs/yuko_recruit_docs/adr/0019-keyframe-animation-model.md) **Accepted**（2026-07-02）で本項除外を段階解除中＝per-frame 描画・FREE要素＋グループ・EPIC #254。α-4 は簡易プリセット＋グループまで出荷し、高度アニメ（複数KF/Ken Burns/音量KF・掛け合い×動画×アニメ）は α-5＝ADR-0023 へ（§11・Codex 監査 2026-07-13）。場面横断タイムライン／複数トラックは α-4 で対応決定（下記 ADR-0018）。**

> ※ **場面横断タイムライン／複数トラック**は [`adr/0018`](docs/yuko_recruit_docs/adr/0018-cross-scene-timeline-model.md) **Accepted**（2026-07-01・α-4）＝本項「完全自由タイムライン」除外を**段階解除**。**2モデル方式**（場面ベース正準＋`compileTimeline` で時間軸射影＋場面アンカー/絶対時間の `timelineOverlay`・schema 1.15）で、α-4 に ③(1) compileTimeline・③(2) 読み取り専用UI・③(3) overlay を実装。編集UI・平行トラックは後続。**キーフレームは④（ADR-0019）で別途**。**再生ヘッド＋同期プレビューの統合編集は α-5 主軸（[`adr/0023`](docs/yuko_recruit_docs/adr/0023-integrated-timeline-editing.md) Proposed・EPIC #329）**。

> ※ **本項「本格タイムライン編集」の除外は、[`adr/0032`](docs/yuko_recruit_docs/adr/0032-timeline-project-format.md) **Proposed**（2026-07-28）で**全面解除**の方向。タイムライン編集を**別プロジェクト形式**として新設し（場面形式から片道で焼き出し・AI は上流のみ・時間軸ネイティブ・トラック自由）、**α-5＝タイムライン編集の完成**とする。ADR-0018/0023 を一部 Superseded。**承認後に本項と `§2-4`（テンプレ駆動・座標を触らせない＝**場面形式に限る**旨の限定）を確定改訂する**。

---

## 11. 主要な設計判断（ADR）と未決定事項

**決定済み（ADR）**
- 描画一致方式（論点③）: [`adr/0001`](docs/yuko_recruit_docs/adr/0001-rendering-parity.md) **Accepted**／一部 Superseded（[`adr/0019`](docs/yuko_recruit_docs/adr/0019-keyframe-animation-model.md)・2026-07-02） — 方式A2ハイブリッド。`05_RENDERING_SPEC.md` 追従改訂済み。**アニメのある場面のみ per-frame（毎フレーム描画＝選択肢C）へ置換＝ADR-0019 が preview＋export に land（`frames_scene_args`＋image2 で1動画セグメント）。A2ハイブリッド・パリティ原則・共有 `layoutScene`/`layoutToSvg`/単一ラスタライザ・アニメ無し場面の静止1枚は存続**。
- FFmpeg/コーデック: [`adr/0002`](docs/yuko_recruit_docs/adr/0002-ffmpeg-codec.md) **Accepted** — FFmpeg は LGPLビルド＋動的リンク＋ソース提供。**H.264 エンコーダの選択は [`adr/0013`](docs/yuko_recruit_docs/adr/0013-h264-via-media-foundation.md) で更新**。
- H.264 書き出し: [`adr/0013`](docs/yuko_recruit_docs/adr/0013-h264-via-media-foundation.md) **Accepted** — **Media Foundation（`h264_mf`）主経路**（OS提供）。配布用 LGPL ビルド（BtbN win64-lgpl）に h264_mf 実在＋アプリ実書き出しを **Windows 実機で検証済＝自前ビルド不要**。OpenH264 はフォールバック。**配布パッケージング（#119・α は MSI 単独）・Windows N 検知（#120）・ビットレート最適化（#121）はいずれも実装済**。
- ナレーション音声: [`adr/0003`](docs/yuko_recruit_docs/adr/0003-narration-voice.md) **Accepted**（「常時表示・OFF なし」は [`adr/0025`](docs/yuko_recruit_docs/adr/0025-credit-display-modes.md) で一部 Superseded） — VOICEVOX:ずんだもんを**ナレーター**として使用（ゆうこ固有の声とは称さない）＋クレジット表示（**About は必須維持**・動画側の表示方式は ADR-0025 で選べる）。
- VOICEVOX同梱: [`adr/0005`](docs/yuko_recruit_docs/adr/0005-voicevox-bundling.md) **Accepted** — エンジンを**同梱しアプリ起動時に自動起動**（接続先設定は上級者向けフォールバック）。規約確認済み・クレジット表示は維持。実装/配布の詳細は ADR 未解決論点。
- ゆうこ＝自社保有で権利クリア（`17`）／フォントはOFL系を同梱（游ゴシック等は同梱不可。`13 §6`）。
- 縦型動画（9:16・1080×1920）: [`adr/0012`](docs/yuko_recruit_docs/adr/0012-aspect-ratio-and-portrait.md) **Accepted**（2026-06-19）— α版に対応決定。**9:16のみ**（1:1は将来）・縦テンプレは**全9カテゴリ**・既存は**16:9固定移行＋向き変更（16:9⇆9:16）導線**・尺上限は横型踏襲。コーデックとは独立の別トラック（#118）。
- コンポーネント/対話テスト基盤: [`adr/0014`](docs/yuko_recruit_docs/adr/0014-component-test-foundation.md) **Accepted**（2026-06-25）— Vitest に jsdom を追加し `@testing-library/react`＋`jest-dom` を導入。**既定 environment は node 維持**・DOM が要る `*.test.tsx` のみファイル先頭 `// @vitest-environment jsdom` で個別切替（既存 node 純粋ロジックテストへ波及なし）。最小構成（happy-dom ではなく jsdom・user-event は当面見送り）。正典/schemaVersion 影響なし。
- テンプレ作成エディタ（ユーザーテンプレ）: [`adr/0017`](docs/yuko_recruit_docs/adr/0017-template-authoring-editor.md) **Accepted**（2026-06-27・EPIC #214）— 利用者が見た目パターンを**ゼロから作成/複製編集**できるフルエディタ（§10 緩和＝[`adr/0016`](docs/yuko_recruit_docs/adr/0016-detailed-editing-completion-roadmap.md)）。ユーザーテンプレ＝**普通の Template**（`user_tmpl_NNN`・グローバル永続化・`template.schema` 不変＝`11 §2.1`）。①の編集UXを流用、`decor` 非開放、**AI 入力からは既定で除外**。場面のテキスト欄はテンプレのテキスト層から生成（④b）。
- 場面横断タイムライン／複数トラック（③・**α-4 実装中**）: [`adr/0018`](docs/yuko_recruit_docs/adr/0018-cross-scene-timeline-model.md) **Accepted**（設計 2026-06-28→α-4 実装着手 2026-07-01）— **2モデル方式**：場面ベースを**正準**（AI 生成・場面編集）に維持しつつ、`compileTimeline(project)` で**時間軸＋トラック**へ機械射影し、書き出しと**専用タイムラインUI（別画面）**が共有。時間軸の自由編集は場面アンカーの任意オーバーレイ層に保存し AI/簡易は無視（推奨）。AI は場面のみ・**単一パイプライン維持**（ADR-0007 M-A）、場面は静止のまま（per-frame は④/`adr/0019`）。**実装＝③(1) compileTimeline（#322）／③(2) 読み取り専用UI（#323）／③(3) `timelineOverlay`（schema 1.15・場面アンカー＋絶対時間・`compileTimeline` マージ）**。`§10`「完全自由タイムライン」を段階解除中（編集UI・平行トラックは後続）。
- キーフレーム／場面内アニメ（④・**α-4 実装着手**）: [`adr/0019`](docs/yuko_recruit_docs/adr/0019-keyframe-animation-model.md) **Accepted**（2026-07-02・実装は段階出荷＝EPIC #254）— **ADR-0001 の選択肢C（毎フレーム Web 描画）を発火**＝`layoutScene(scene, template, t)` でキーフレーム補間したレイアウトをフレームごとに SVG→PNG。**パリティをフレーム単位で構造保証**（preview/export 同一）。キーフレームは ADR-0018 オーバーレイに格納（AI/場面正準は不変）。**アニメ無し場面は静止1枚を維持**（後方互換）。**決定（利用者合意 2026-07-02）＝対象は FREE 要素＋グループ・プロパティ x/y/scale/opacity/rotation＋イージング(linear/ease-in-out)・fps30固定・プレビューは二層（正本 per-frame／編集中 近似・補間式共有）**。段階＝(1a) 補間基盤＋(1b-preview) プレビュー毎フレーム＋(1b-export) `frames_scene_args`＋image2 書き出し＋(1c) オーサリングUI（**場面編集の「ふわっと表示」プリセットで FREE 要素にフェードイン**・opacity を text/image にも適用）＋(2) 動きプリセット拡張（**ふわっと/すべって/ぽん/くるっと＋イージング選択**・FREE 要素・種類は keyframes から導出＝schema 不変）＋(3) グループ対象（プリセットをグループ全体へ・合成前 transform 重ね＋メンバー opacity 乗算）【実装済】→(3残) 複数KF/Ken Burns（手動編集＝将来タイムライン）→(4) 音量KF。**アニメ編集は二層＝簡易プリセットは場面編集／詳細キーフレームは将来タイムライン（上位仕上げ・ADR-0023）**。**per-frame が preview＋export に land 済＝`adr/0001` を一部 Superseded**。`§10`「キーフレーム」を段階解除中（口パク・3Dは対象外）。**α-4 出荷範囲＝(1a)〜(3)（簡易プリセット＋グループ＋per-frame land 済）。(3残) 複数KF/Ken Burns・(4) 音量KF・掛け合い×動画×アニメ（現状は UI ガードで静止＝#469）は α-4 完了条件から外し、α-5 の統合タイムライン（[`adr/0023`](docs/yuko_recruit_docs/adr/0023-integrated-timeline-editing.md)・EPIC #329）へ送る（Codex 監査 2026-07-13・利用者決定）。**
- テンプレ既定素材（template-owned default assets）: [`adr/0021`](docs/yuko_recruit_docs/adr/0021-template-owned-assets.md) **Accepted**（2026-06-29・α-3 追加・実装は EPIC サブPR A〜D）— テンプレが**既定素材（背景等）を持てる**。素材ファイルは**グローバル保存**（`user_templates/assets`・id=`tmpl_asset_NNN`）、`Layer.assetId`＋テンプレ `assets` マニフェストで参照。描画は **`scene.assetRefs[layer.id] ?? layer.assetId`**（場面素材が優先・テンプレ既定はフォールバック）。見本は持ち主写真の自動流し込みをやめる（①）。**ADR-0017 の「`template.schema` 不変／1テンプレ=1ファイル」を一部改める**（schema は任意追加で版据え置き＝`11 §1`／素材を持つテンプレは単一JSON共有不可＝bundle は将来）。
- 統合タイムライン編集（**α-5 主軸・設計のみ**）: [`adr/0023`](docs/yuko_recruit_docs/adr/0023-integrated-timeline-editing.md) **Proposed**（2026-07-02・実装は α-5＝EPIC #329）— タイムライン編集画面に**再生ヘッド＋同期プレビュー＋グローバル時間の再生エンジン**を統合し「再生しながら複数トラックで編集」へ。`compileTimeline`＋`layoutScene(t)`（④）を共有しデータモデル不変・パリティ維持。段階＝再生ヘッド→連続再生→スクラブ→ヘッド吸着→SE/平行音声（#258 合流・track enum 拡張時に schema バンプ）。④のプレビュー・パリティ戦略は本ADRの統合再生を見込んで決定する。**役割分担＝場面編集は簡易面／タイムラインは上位仕上げ面**（利用者合意 2026-07-02）、**α-5 最小到達点＝再生ヘッド＋シーク＋同期プレビュー＋lines 導線**（選択→編集元ジャンプ・声作成・ヘッド→有効行）。**周辺方針（2026-07-02）＝時間精度は「秒（実数）=正準・フレーム=出力時の量子化」（既定30fps固定運用・④/再生エンジン/書き出しで同一格子）・ミュート/ソロ=派生状態（保存しない）・素材欠損=15準拠・差別化軸7項と対象外を明文化**。
- 非破壊編集モデル（**α-5 設計のみ**）: [`adr/0024`](docs/yuko_recruit_docs/adr/0024-non-destructive-editing-model.md) **Proposed**（2026-07-02）— **Asset＝元素材の源泉／使用単位＝非破壊の範囲参照**（物理分割しない）。担い手は新モデルでなく既存2系統＝場面側 per-use 上書き（`slotFits` 同型・例 `scene.slotClips`）＋タイムライン側 `OverlayClip` の track/フィールド拡張（いずれも schema は実装PRでバンプ）。分割＝場面の分割として実現。波形/サムネ列は再生成可能キャッシュ（正準外）。`scene.lines` は不変・将来の VoiceClip 方向はグローバル音声 amix パス新設が前提。
- 要素のグループ化（groups＋独自transform）: [`adr/0022`](docs/yuko_recruit_docs/adr/0022-element-grouping.md) **Accepted**（2026-06-30・α-3 追加・**v0.3.0 含む**・実装は EPIC サブPRに分割）— 要素（図形/素材/文字/レイヤー）を**グループ**（`group_NNN`・自前 transform を持つ独立オブジェクト）に束ね、まとめて移動/拡縮/回転/非表示/ロック/重ね順。**FREE＋テンプレ両エディタ**（テンプレは複数選択を新設）。描画は**共有 layout でグループ transform を前合成**して `LayoutItem` に落とす＝**プレビュー＝書き出しのパリティ維持**（ADR-0001）。`scene.groups`/`template.groups` 任意追加（project 版上げ・template 据え置き）。AI 出力にグループは無い（単一パイプライン・ADR-0007）。α-4 キーフレーム（ADR-0019）の animation 対象にも。
- クレジット表示方式（**α-6・#359**）: [`adr/0025`](docs/yuko_recruit_docs/adr/0025-credit-display-modes.md) **Accepted**（2026-07-03・事業側決定・ADR-0003「常時・OFF なし」を一部 supersede）— 動画のクレジット表示を**5方式から選べる**（常時/最初の数秒/最後の数秒/最初と最後/**非表示**・**既定=最初と最後**）。**About 画面のクレジットは必須として不変**（`13 §4`）。**非表示可**（社内利用の事業側判断）＝非表示時は注意＋**使用 VOICEVOX 一覧のコピー導線**（概要欄運用の補助）。**掛け合いの話者も集約して網羅**（`creditForLine`＋`usedVoiceCredits` 横断・#251 About 集約と共有）。**preview=export は表示区間定義を共有**（先頭[0,N]/末尾[尺-N,尺]・書き出しはテロップ overlay 機構再利用）。schema マイナーバンプ（`videoSettings` にクレジット設定）は実装PRで。
- α-4 挙動一致の原則（**α-4・Codex調査 2026-07-06**）: [`adr/0026`](docs/yuko_recruit_docs/adr/0026-alpha4-behavior-consistency.md) **Accepted**（2026-07-06・利用者決定）— 段階実装で割れた意味論を**挙動として**解消する。判断軸＝**①設定した意味どおり ②動画/掛け合いの有無で同概念同挙動 ③プレビュー=書き出し ④「壊れて見える仕様止まり」を警告で済ませない**（現状維持は「UXとして自然」か「開発都合」かを明示・後者は修正対象）。決定＝**間×入場遷移は切り替え尺優先**（per-scene xfade・#430）／**複数動画スロット対応**（1場面1動画の撤廃・zIndex一般合成・#431＝ADR-0006 未解決#2 を対応決定・2枚固定を一部改める）／**仕上がり確認の動画実再生**（#432【実装済】＝再生中のみ下SVG/video要素/上SVG の3層で実映像を流す・`splitVideoSceneSvgMulti` 共有＝書き出しとパリティ・`SlotVideo` は ADR-0023 α-5 再生ヘッドが流用）／**compileTimeline の collapse 撤去**（#433）／**分割失敗の静かな静止画化禁止**（#434【実装済】＝動画スロットがあるのに配置できない場面は書き出しを§2-5 エラーで停止し、precheck でも場面つきで警告＝`videoSlotUnplaceable`/`unplaceableVideoSceneNumbers` 共有・黙って静止画化しない）／**動画×アニメ除外の解除**（静止層 per-frame＝#435／動画スロット本体の位置・拡縮・回転・不透明度＝#442「アニメ区間は**動画の実フレーム**で場面全体を per-frame 合成＝動きながら再生・既定は先頭から＋settled 区間は実動画」の2段・`stage_clip_frames`/`read_export_frame`/`build_window_audio`・ADR-0019 追補済み・開始タイミング設定は後続）。schema 不変（IPC 入力のみ拡張）。
- 動画スロット本体アニメの再生開始タイミング（**α-4・#442 後続**）: [`adr/0027`](docs/yuko_recruit_docs/adr/0027-video-slot-start-timing.md) **Accepted**（2026-07-10・利用者承認／実装は段階＝schema 1.18→書き出し→UI）— #442 は「アニメと同時・先頭から」固定。利用者要望で**同時／途中／アニメ後**を選べるようにする。保存は**モード明示（discriminated）**＝**`scene.slotVideoStart?: Record<layerId, { mode: 'withAnim'|'afterAnim'|'delay', delaySec? }>`**（`slotFits` 同型・enum は正典化＝`VIDEO_START_MODE`・欠落=`withAnim`）。**絶対秒保存を採らない理由**＝アニメ長 W 変化で「アニメの後」が黙って「途中」に化ける（ADR-0026①違反）。`project.schema` **1.17→1.18**（additive・移行不要＝`persistence.ts` の `PROJECT_SCHEMA_VERSION` も 1.18 へ）。意味＝共有純粋関数 `clipTimeAtSceneTime(t,{d,c,s}) = c + max(0,t−d)·s`（preview シーク＝export 量子化で共有・パリティ）。settled 開始 `= c+(W−d)·s`。**アニメ対象スロットのみ**（`slotIsAnimated`）UI 表示・アニメ削除時はエントリを落とす（黙って無視しない・#469 流儀）。**`afterAnim` は settled が残る場面のみ**（`animEnd≥尺` は非表示＋理由・§2-5／precheck 警告）。書き出しは #442 窓経路を再利用（IPC に `clipAudio.delaySec`＝schema 不変）。掛け合い×動画×アニメは #469 で静止に倒れており対象外。**実装は段階＝schema 1.18（本PR #1）→書き出し→UI**。
- 動画クリップ調整の per-use 化＋Undo（**α-4・#472**）: [`adr/0028`](docs/yuko_recruit_docs/adr/0028-per-use-clip-and-undo.md) **Accepted**（2026-07-11・利用者承認／per-use の挙動変化は「一旦決定・指摘が上がれば再検討」）— クリップ調整（範囲/速度/元音声）は `asset.clip`（assets）更新で、ADR-0020 の履歴 slice（`meta/parts/scenes`・assets 除外）の外＝**Undo 不可**（#472）。ADR-0024 決定1（per-use 上書き `scene.slotClips`・`slotFits` 同型・`Asset.clip` は既定）を**確定**し、クリップ調整を**場面（scenes）に載せる**ことで ADR-0020 履歴で**自動 Undo**＋per-use（場面ごと別範囲）を得る。**`scene.slotClips?: Record<layerId, { startSec?, endSec?, speed?, useOriginalAudio?, originalAudioVolume? }>`**（`fit` は既に `slotFits` で per-use ゆえ対象外）。継承＝`slotClips ?? asset.clip ?? 既定`（null=継承）。描画は `findVideoSlots` に per-use 解決を1か所追加（preview=export 不変）。場面編集の `ClipDetailControls` は slotClips を編集（Undo 可・drag は履歴グループ復活＝#389 巻き戻し）・素材画面は `asset.clip`（既定）を編集（従来どおり Undo 外）。schema マイナーバンプ（additive・移行不要）。**assets を履歴に入れない**（ADR-0020 の除外理由を尊重）。**実装は段階＝schema→描画解決→ClipDetailControls 編集先分岐＋Undo**。
- FREE 字幕＝複数配置＋対象紐づけ（**0.4.2・#518 再スコープ**）: [`adr/0029`](docs/yuko_recruit_docs/adr/0029-free-subtitle-multi-and-binding.md) **Accepted**（2026-07-14・#520 で設計3論点確定＋利用者スコープ決定・利用者方針＝拡張性/自由度を保証／実装は段階＝**PR-A+B 済（#521 で一括）**）— #518 は FREE 字幕を**場面の単一字幕**へ束ねる前提で「場面に1つ」制約が要り、再レビューで単一制約の不備（右クリック複製 no-op／schema 未担保）が P1 に。利用者方針は逆＝**字幕は複数配置でき、字幕欄とセリフ（話者）を紐づけたい**。よって前提を「1場面1字幕」から**複数ボックス・各々が対象（`subtitleSource`）を持つ**へ変える（**単一制約＝schema 上限/破壊的移行は導入しない**）。掛け合い（ADR-0015）の `scene.lines[]` は既に行ごと `speaker`/`subtitleText`/`subtitleEnabled` を持つため**additive**。決定＝**FreeElement(subtitle) に `subtitleSource?: {kind:'narration'} | {kind:'allLines'} | {kind:'speaker', speaker:SpeakerKey}`**（判別 union・`SpeakerKey={kind:'catalog',speaker}|{kind:'default'}`・未指定＝現状挙動へ無変換解決・単独→読み上げ／掛け合い→全行）。基本は**(2a) ボックス→話者**、細かい**(2b) 行→ボックス（`NarrationLine.subtitleTarget`）は任意上書き層**＝**(2c) 併用を推奨**。#518 の schema 1.20（subtitle 種別）は本機能へ畳み込み一括バンプ。**#518 は単一制約を固める方向ではマージせず draft 化・再スコープ**（scaffolding は流用）。**#520 レビューで確定した設計論点＝[P1-1] 字幕解決は時刻 t 直接でなく `sceneSegmentSpecs` 直結の共通 `segmentAt(scene,lineDurations,t)` で作る `SubtitleMoment{segment}` を消費（`activeLineIndexAt` は該当なしで先頭行を返し間を null にできない＝不採用）＝プレビュー=書き出しで間/0秒行/自動逐次を一致／[P1-2] `lines.speaker` は実効話者で比較＋`number|null` の矛盾を解消し `SubtitleSource` を判別 union（`narration`/`allLines`/`speaker:{catalog:number|default}`）＝共有 `effectiveSpeakerKey(line)`（voiceBase 不要）・既定声の行も話者ボックスへ（ADR-0026②）／[P2] 有効な `subtitleTarget` の行は指定先だけに排他表示（二重表示なし）・要素削除で解除→(2a)フォールバック・読込検証で壊れ参照修復＝字幕を黙って消さない（§2-5/ADR-0026④）**。共有 `layoutScene` でパリティ維持（ADR-0001）・**二重描画は別対象＝別文で構造解消**。**スコープ決定（利用者2026-07-14）＝(2a) ボックス→話者を先行・(2b) 行→ボックス（`subtitleTarget`・排他）は α-5（ADR-0023）／同一対象重複は許容＋注意（PR-C）／リリースは 0.4.2（schema 1.20 を 0.4.1 に混ぜない＝PR-A は 0.4.1 後に develop へマージ）**。実装段階＝**PR-A+B 済（#521 で一括＝模型＋描画）**（`SubtitleSource`/`SpeakerKey` 判別 union・`segmentAt`・`effectiveSpeakerKey(line)`・`resolveSubtitleForElement`・`subtitleBinding.ts`・schema 1.20／`layout.ts` FREE `case subtitle`＝`isSubtitle:true`／書き出し掛け合い3経路＋プレビューに `subtitleSegment` 配線／`voiceBase` は不要と確定＝`{default}` は場面内一意）→ **PR-C UI 済**（`SceneEditScreen` に「字幕」追加ボタン〔複数可〕＋編集フォーム＝対象選択〔読み上げ/全部/`sceneSubtitleSpeakerOptions` の話者〕＋単独 `texts.subtitle` 編集欄・右クリック複製可＝#518 no-op 解消・同一対象は注意）。残るは (2b) 行→ボックスのみ＝α-5。**save-able な schema を描画未接続で単独マージしない**（レビュー #521 P1／ADR「機能PR一括バンプ」）。
- 通常↔FREE 切替の非破壊コンテンツ移送（**0.4.2・#524 レビュー P1/P2**）: [`adr/0030`](docs/yuko_recruit_docs/adr/0030-normal-free-switch-migration.md) **Accepted**（2026-07-14・利用者決定＝非破壊/往復可）— #524（FREE 全場面化）で切替時のデータ移送が欠け、**通常→FREE で `assetRefs` が無言消失**（P1・FREE はスロット無し＝#236 清算で全消去・`freeLayout` へ移らない）／**FREE→通常で休眠 `freeLayout` が precheck・素材使用を汚す**（P2）。決定＝**通常→FREE は表示中の内容（スロット素材＋文字）を旧テンプレ幾何ごと `freeLayout` へ自動変換（seed・空のときだけ）＝`freeLayoutFromPlacedContent`**／**FREE→通常は `freeLayout` を休眠保持**（描画/編集は既に category ゲート・**事前確認/素材使用も実効表現＝`templateOf(s).category===free` でゲート**）。往復で自由配置が戻る（`texts` 休眠 #236 の延長）。**正典（11）＝`freeLayout` は任意 `sceneType` に存在しうる（有効は FREE テンプレのみ＝それ以外は休眠）**・schema 据え置き（任意フィールド・版不変）。**再レビュー（#524 P1×3）で変換対象を拡張＝`slotClips`（動画クリップ調整）を旧層 id→新 FREE 要素 id へ移送・立ち絵（`poseAssetId`→slot 要素）・字幕層（→subtitle 要素・単独 narration/掛け合い allLines）も変換／装飾のみ対象外**。**素材使用判定を `sceneActiveAssetIds` に一本化**（事前確認＋逆引き〔MaterialsScreen〕＋削除確認が同一規則・休眠を数えない）。さらに**グループ変形/非表示も実効配置で展開**（`composeGroupGeometry`/`isHiddenByGroup`＝通常描画と一致）・**FREE スロット候補を `isFreeSlotAssetType` に一本化**（移送した立ち絵/ロゴを選び直せる）・**字幕背景帯の FREE 持ち込みは #529 で追跡**（0.4.2）。**非破壊往復（Option A・利用者決定）＝通常配置（assetRefs/slotFits/texts）も切替で清算せず休眠保持し FREE→通常で自動復元・FREE→通常は「動画に出なくなる中身」があれば切替前に確認（#547 P2-9 で改定＝復元の有無でなく復元先を超えた分を数える `freeContentHiddenBySwitch`・件数つき文言・「まとめて標準にする」も同関数へ委譲／**確認は答えるまで残す**＝件数は文言へ反映するが表示は連動させない〔消して足し直しただけで確認が蘇るため〕・見た目ピッカーと種類セレクタで同挙動＝PR #592 レビュー）**・**zIndex 未指定は `effectiveLayerZ`（domain/template）を通常描画と共有＝重なり順一致**（#524 再レビュー P1/P2）。#528（種類変更導線）とも同じ `switchSceneTemplate` 経路。**追補6（#547 P3-14・2026-07-24）＝通常→通常の切替も非破壊にする**：非破壊往復は FREE 方向にしか効いておらず、差し込み先の無い種類へ変えると `assetRefs`/`slotFits` が #236 清算でその場から消え往復で戻らなかった（`texts`/`freeLayout` は戻るのに非対称）。決定＝**`switchSceneTemplate` はどちら向きでも清算しない**（切替先の層一覧は**引数から落とす**＝絞り込みの復活を構造的に防ぐ）／**`sceneActiveAssetIds` を通常テンプレ側でも絞る**（差し込み先の層が実在するキーだけ・立ち絵は character 層があるときだけ＝`layoutScene` と同条件・template 未解決は絞らず安全側）／台本表の主役素材（`adapters.mainAsset`）も同関数を通す。**正典（11 §5）＝「キー集合 ⊆ スロット id」は保存データの制約でなく描画・実効使用の条件**（休眠キーを持ちうる）・schema 据え置き。**通常→通常でも確認を出すかは未解決**（いまは出さない＝往復で戻り編集画面で即見えるため）。

- 同時2ボイス（並行音声・**α-4 最小形＝同時開始・0.4.2**）: [`adr/0031`](docs/yuko_recruit_docs/adr/0031-simultaneous-dual-voice.md) **Accepted**（2026-07-14・実装 2026-07-15・scope A）— 「2人を同時にしゃべらせたい」。掛け合い（ADR-0015）の逐次・単一トラックに対し、**同時開始＝並行（重ねて）流す**を追加。**モデル＝`NarrationLine.startWithPrevious?`（フラグ・`true` 連続で N 人同時・schema 1.20→1.21・additive）**。`lineTimeline`（`groupIndices`／同時グループは同一窓共有／`sceneSegmentSpecs` は 1グループ=1セグメント＋`parallelLineIds`／`segmentLineIds`）を正準に、**書き出し amix**（動画経路＝既存 `narrationSegments` を同 delay で重ねる／非動画＝Rust `mix_narrations`）・**プレビュー並行再生**・**字幕は通常テンプレで2人目以降を上へ自動配置＝重ならない別ボックス**（#530・`layout` が `parallelLineIds` から帯を積む・段間は実折返し行数〔共有 `textWrap`〕で詰めるので長文2行でも重ならない・FREE `allLines` は `\n` 結合／`speaker` は自分の行だけ・テンプレ字幕は `anchorBottom` で画面外に出さない・**画面外へはみ出す場合は §2-5 警告** `subtitleOverflowsCanvas`〔実 layoutScene の字幕を全層・全辺・回転込みで検査〕＝黙って画面外に切らない。**#563 で検査対象を単独/逐次の場面へも拡大**〔#555 の体裁上書きで字幕を拡大できるため到達性が上がった〕＋公開前チェックにも項目を追加・案内は原因で出し分け〔同時＝セリフを減らす／1帯＝小さくする・短くする〕）・**簡易トグル**（2人目以降「前のセリフと同時に流す」・Undo 可）。**V18（`scene.lines[]` 時間重複なし）は改定不要**＝フラグ方式は startSec を保存しない（11 §8 に注記のみ）。**タイムライン非依存**（開始オフセット/多トラック/再生ヘッドは α-5＝ADR-0023・#258）。掛け合い×動画×アニメは #469 で静止のまま対象外。
- タイムライン編集＝**別プロジェクト形式**（**α-5 の再定義・#329 を置き換え**）: [`adr/0032`](docs/yuko_recruit_docs/adr/0032-timeline-project-format.md) **Proposed**（2026-07-28・利用者ヒアリング完了／**実装は承認後**）— 利用者の想定は「**場面形式 →（片道変換）→ タイムライン形式**で、変換後は完全に別物。AI が関与するのは変換前まで」。ADR-0018 は3案（全面再設計/読み取り専用/2モデル）しか検討しておらず、**この「片道変換で別文書」案は未検討**だった（(A) の不採用理由「AI が時間軸を吐く必要」は本案には当たらない）。**α-4 のタイムライン編集は利用者の動作確認対象外**（後で改修が入る前提）＝積み増す前に決める。決定＝**タイムラインプロジェクトを新設**（**FREE 自由配置〔空間の自由〕× タイムライン〔時間の自由〕を最初から両方持つ文書**＝場面の区切りを持たず、テンプレは「枠」ではなく**置ける素材**）／**元の場面形式は残る**・焼き直しは**常に別の新規**（差分マージなし）／**トラック自由**・**焼いた場面は既定1クリップで「バラす」可能**・**テンプレの差し込み口は生きている**・**タイムライン側でも声を作れる**・**完全新規のタイムラインプロジェクトも作れる**／射程は**最低限＋中位**（速度変更・クロップ・全プロパティKF・トランジション自由配置まで。カラー補正/クロマキー/マスクは α-6 以降）／書き出しは**ハイブリッド・迷ったら全フレーム描画**／**`timelineOverlay` は捨てる**（開いたとき黙って消さず断る＝§2-5）／場面形式には**読み取り専用の見わたすタイムラインだけ残す**（編集用画面は廃止）／素材は**コピー**（ADR-0024 (6) 自己完結）／**焼き出しは全体/パート/範囲を選べる**／**α-5＝タイムライン編集の完成**（α-6 は問題修正＋必要なら追加）／場面形式は**凍結**＝**変更の種類で線引き**〔続ける＝不具合修正・AI 生成の品質・テンプレ・素材と声・書き出しの共通核・文言や操作性／凍結＝場面編集の編集機能の拡張・時間軸まわり・Scene への新フィールド。FREE の拡張とキーフレームは凍結側へ倒す〕。**`§10`「本格タイムライン編集」の除外は全面解除へ**・**`§2-4`（テンプレ駆動・座標を触らせない）は場面形式に限る**旨の限定が要る。**ADR-0018/0023 を一部 Superseded**（2モデルの射影は場面形式内の読み取り用として残る）。**文書モデルとスキーマは #627 で確定**＝**`schemas/timeline-project.schema.json` を新設**（版は場面形式と**独立**・初期 `"1.0"`）／**形式の判別はトップレベル `format`**＝**`"timeline"` か否かの一点**（**場面形式は `format` を書かない**＝不在が場面形式・`"scene"` は読込時の解決値で永続化しない〔`project.schema` は `additionalProperties:false` ゆえ書くと通らない＝CI の must-reject で固定〕・`projectId` の採番は両形式共通）／**クリップ＝「FREE 要素 ＋ 時間」**（空間の語彙は `FreeElement` と同じ＝描画は `layoutScene` の FREE 分岐を共有）／**クリップに `zIndex` は無く、重ね順はトラックの並び順だけで決まる**＝そのため**同一トラック内は時間の重なりを禁止**（`11 §8` V24・重ねたいならトラックを足す）／素材・見た目設定・グループ・キーフレーム・同梱フォント/BGM の一覧は `project.schema.json` の `$defs` を **`$ref` で共有**（§2-7）。**声の持ち方と焼き出しの形は #628 で確定**＝**`kind:'voice'` を新設**（中身は `TimelineVoice`＝`NarrationLine` から時間・字幕の語彙を除いたもの・制約は `$ref` 共有・schema 1.1）／通常場面＝**1場面1クリップ**（`kind:'template'`・差し込み口が生きたまま）・FREE 場面＝**要素ごとのクリップ＋1場面=1グループ**。**切り替え（トランジション）は決定19**＝**キーフレームで表し専用の入れ物は持たない**（`wipe`/`zoom` は現状どこにも描画されず `fade` に丸められている＝運ぶ情報がゼロ・#634 の「自由配置」はキーフレームの傾斜を自由に置くことで満たす・専用の入れ物は `wipe` を実際に描くときにマスクと同時＝α-6）。**焼き出しは「設定された切り替え」でなく「実効の切り替え」を落とす**＋**網羅漏れがコンパイルエラーになる形で書く**（将来 `wipe` が描けるようになったとき黙って `fade` へ落とさない＝`resolveTransition` の戻り型を実際に描く種別だけの `DrawnTransitionType` に狭め、消費側を網羅 switch で書く）。**焼き出しの分解規則は決定20（#628 変換・対応表の正典は `11 §7.6.1`）**＝`bakeTimelineProject`（`src/domain/timeline/bake.ts`・純粋関数で元 Project を読むだけ＝片道を構造で担保）／**列は1場面ぶんを連続して取り空いた列は下から詰め直す**（重なる2場面の層が互い違いに挟まらない＝切り替えを場面まるごとの不透明度で表せる・入る側を常に手前へ固定はしない〔列が際限なく増える〕ので `fade` は**手前側**に付ける）／**`slide` は両方が一緒に動く**（FFmpeg の `slideleft` 等と同じ）／切り替えの付け先は通常＝テンプレクリップ・FREE＝**場面グループ**（要素の不透明度を潰さない）／**FREE の場面にも見た目パターンのクリップを最背面に置く**（FREE テンプレも `background` 層を持ち動画に出る＝要素だけ焼くと背景が落ちる・決定1 の追補）／**自由配置かどうかは「見た目が解決できればその category、できなければ `scene.sceneType`」**（見た目だけだと未解決場面の `freeLayout`/グループ/アニメが黙って落ち、`sceneType` だけだと通常テンプレの休眠 `freeLayout` を焼いてしまう）／**持っていけないものは黙って落とさず `BakeNote` で返す**（`15 §6` `BAKE_*`＝**行に追従する字幕**〔#633 と同時。時間で変わらないもの＝セリフ列の無い場面のテンプレ字幕・FREE の対象＝読み上げの字幕は焼く。**行数では判定しない**＝1行の `lines` でも差し替わる〕・動画の再生開始タイミング〔ADR-0027・置き場が無い〕）。**焼き出しの保存経路も land**（#628）＝`bakedFilePaths`（運ぶのは素材の本体・動画の代表フレーム・作成済みの読み上げ音声／相対パスの構造を保つので文書のパスを書き換えない）＋Rust `copy_project_files`/`project_files_size`＋store `bakeToTimeline`（**焼く前に元を保存**＝未保存の声を落とさない・**ファイルを運んでから文書を保存**＝素材の無いプロジェクトを一覧に残さない）/`estimateBake`（**見積りでは id を発行しない**＝番号を飛ばさない）。**読込の入口で形式を判別**＝`format:'timeline'` は場面形式として読まず「形式が違う」と断る（版の話にすり替えない・`15 §6` `PROJECT_FORMAT_UNSUPPORTED`）。**焼き出しの入口は「見わたすタイムライン」画面**（`BakeToTimelinePanel`・`06 §12`）＝**押した瞬間に作らない2段階**（①元は残る ②増える容量 ③持っていけないもの、を見せてから作る）・範囲は全体/パート/場面の範囲・**範囲や名前を変えたら確認をやり直す**・**場面が入らない範囲では作らせない**。残る未解決＝`timelineOverlay` 削除の移行と版管理／**声と字幕の連動の具体形**（#633）／ハイブリッドの境界／「バラす」の可逆性／**焼いた動画を開く先（編集画面）は #629**（いまは開くと「形式が違う」と断る）。

**未決定（リリース前に確認）**
> 全体整理は [`13_DEPENDENCIES_AND_LICENSING.md`](docs/yuko_recruit_docs/13_DEPENDENCIES_AND_LICENSING.md) §9 チェックリスト。
- ~~FFmpeg 配布パッケージング~~ → **実装済**：win64-lgpl-shared（動的リンク）を pin 同梱＋`FFmpeg_SOURCE.md`（ソース提供）＝#119／Windows N 検知＝#120／ビットレート最適化＝#121。α は **MSI 単独配布**（NSIS は ~2GB 同梱で不可）。
- フォント選定 → **初期3種を選定・同梱（#161・全 SIL OFL 1.1）**：gen-interface-jp（既定/本文）・gen-interface-jp-display（見出し）・怪盗予告ゴシック（演出）。**動画全体（`videoSettings.fontId`）＋場面ごと（`scene.fontId`・「動画全体に合わせる」で継承＝schema 1.5）**に選択可。追加は段階的。（※APIキーのOSキーチェーン保管は実装済＝ADR-0010／`13 §7`）
- 標準BGM → **実装済**：CC0 3曲（Open Music Academy）を同梱＋書き出しで選択（`public/bgm/`・`bgmSettings.bundledBgmId`＝schema 1.4・権利台帳 `13 §8.1`・About にクレジット）。装飾アセットは当面なし。（正式名 **すたりお（stario）**＝ADR-0011。**ウィンドウタイトル/About 表示＝「すたりお」**、**`productName`（インストーラ/アプリ名）＝ASCII の `stario`**＝WiX `light.exe` が日本語の MSI ファイル名で失敗するため。`identifier` 由来のデータパスは無影響）
