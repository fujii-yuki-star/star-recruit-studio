# ADR-0031: 同時2ボイス（並行音声・α-4 最小形＝同時開始）

- **状態**: Accepted
- **日付**: 2026-07-14（実装 2026-07-15・scope A）
- **関連**: [`ADR-0015`](0015-dialogue-timeline-model.md)（掛け合い＝逐次のセリフ列） / [`ADR-0024`](0024-non-destructive-editing-model.md)（「並行音声は amix パス新設が前提」） / [`ADR-0023`](0023-integrated-timeline-editing.md)（統合タイムライン・α-5・#258 SE/平行音声） / [`ADR-0029`](0029-free-subtitle-multi-and-binding.md)（字幕ボックス→話者紐づけ） / `ADR-0001`/`ADR-0026`（パリティ） / `CLAUDE.md §10/§11`

## コンテキスト
スモークで「**2人を同時にしゃべらせたい**（同時に2つの別々のボイスを流す）」要望（利用者・2026-07-14）。現状の掛け合い（ADR-0015）は `scene.lines[]` を**逐次**再生する（`sceneSegmentSpecs` が区間を順に連結＝単一音声トラック）。並行（重なる）音声は ADR-0024 が「**グローバル音声 amix パス新設が前提**」とし α-5（統合タイムライン・ADR-0023／#258）想定だった。

利用者方針＝「**プレビュータイムライン編集が絡まない改善は α-4 で全体的に終わらせたい**」→ 並行音声の**最小形（同時開始）**を 0.4.2 へ前倒し（利用者決定 **A**・2026-07-14）。開始オフセット等の時間軸編集は α-5 に残す。

## 判断軸
- §2-4 テンプレ駆動維持・非技術者 UX（簡易トグルで足りること）。
- パリティ（ADR-0001/0026）：プレビュー=書き出し=静止画=compileTimeline を同じ区間モデルで駆動。
- 既存正準経路（`sceneLines()`／`sceneSegmentSpecs`）を壊さない（additive）。
- α-4/α-5 境界：**時間軸編集（再生ヘッド/スクラブ/多トラックドラッグ）は α-5**（ADR-0023）。同時開始は α-4。

## 検討した選択肢（スコープ）
| 選択肢 | 評価 |
|---|---|
| **A 最小形・同時開始（採用）** | 2人同時「開始」＋amix＋字幕2段。編集は簡易トグル＝タイムライン非依存。α-4 で完結。 |
| B フル（開始オフセットも） | 「2つ目を◯秒ずらす」等。時間軸編集＝α-5 に一部踏み込む。0.4.2 が重い。 |
| C α-5 へ | 統合タイムライン（ADR-0023・#258）と一緒に。0.4.2 に含めない。 |

## 決定（Accepted・scope A・利用者決定 2026-07-14／モデル確定 2026-07-15）
1. **モデル（additive・確定）**：`NarrationLine.startWithPrevious?: boolean`（**フラグ**方式・利用者決定 2026-07-15）。`true` の行は直前の行と**同じ開始**で並行、`true` の連続で **N 人同時**（2人固定でなく N＝利用者決定）。**開始オフセットは持たない**（同時のみ・α-4）。`project.schema` 1.20→**1.21**（additive・移行不要）。同時グループのメンバーは同一窓 `[グループ開始, 次グループ開始)` を共有し、グループ長＝メンバー音声長の最大（`lineTimeline.groupIndices`／`lineSegments`）。単独行（フラグ無し）は従来と同値（後方互換）。
2. **音声（核心・新設）**：並行する行を **amix でミックス**する書き出し経路を新設（現状の逐次単一トラックに対し、重なり区間は2ボイスを重ねる）。プレビューは2音を同時再生。ADR-0024 の「amix パス新設が前提」を α-4 で実装。音量は §6 のミックス規約＋（将来 #259 ノーマライズと整合）。
3. **字幕（ADR-0029 活用）**：2話者に**2つの字幕ボックスを紐づけ**（`subtitleSource={kind:'speaker'}`）、**既定字幕の上/下に重ならないよう自動配置（2段）**。自動字幕もこの2段で表示。
4. **正準経路の拡張**：`sceneSegmentSpecs` は**1グループ=1セグメント**（primary `lineId`＋`parallelLineIds`）へ拡張。`segmentLineIds(spec)=[primary, ...parallel]` を音声/字幕の共通入口にし、プレビュー/書き出し/静止画/`compileTimeline` が同じセグメントで駆動＝パリティ維持。**V18（`scene.lines[]` は `startSec` 昇順・時間重複なし）は改定不要**＝フラグ方式は `startSec` を保存しない（同時グループは実行時に窓を共有）ので V18（**保存された** startSec の重複）に触れない。11 §8 の V18 に「`startWithPrevious` の行は同時開始＝並行ゆえ対象外」の注記のみ追記（意味は不変）。
5. **編集UI**：簡易トグル（例「このセリフを前と同時に流す」）＝**タイムライン非依存**。再生ヘッド/スクラブ/多トラックは α-5（ADR-0023）。

## 結果・影響（実装済み 2026-07-15・4 stage を1 vertical で・機能PR一括バンプ）
- `schemas/project.schema.json`＋`11`：`NarrationLine.startWithPrevious`（1.20→**1.21**・additive）。`persistence`/`validate-schemas`/fixture 同期。
- `domain/project/lineTimeline`：`groupIndices`（同時開始グループ）／`lineSegments`（同一窓共有）／`sceneSegmentSpecs`（1グループ=1セグメント＋`parallelLineIds`）／`segmentLineIds`。単独行は不変（後方互換）。
- `domain/project/narrationLines`：`normalizeDialogueTiming`＝不変条件の正規化（**先頭行はフラグを持たない**・**`startWithPrevious` の行は `startSec` を持たない**）。行の削除/移動・場面分割・読込（`migrateProject`）で呼び、「並べ替えで先頭になった休眠フラグの復活」「実装が無視する `startSec` の残存」を消す＝**設定できるのに効かない状態を残さない**（ADR-0026④・#533 レビュー P2）。`groupIndices` は先頭フラグを実行時にも無視（二重の安全）。
- `renderer/export/buildExportScenes`＋Rust `ffmpeg.rs`：動画経路は `narrationSegments` を同 delay で重ねる（既存 amix が並行化）。非動画経路は primary=`audioBase64`＋並行行=`narrationSegments`、Rust `mix_narrations`（純粋 `narration_mix_filter`＋単体テスト）で `narration` に amix（still/frames/frames_dir 共通）。
- `PreviewScreen`：同時グループは前を止めず重ねて再生（`groupAudios`）・`activeLine` は primary・ライブ音量/ミュートを全員へ。
- `subtitle`：**通常テンプレ字幕は2人目以降を「上へ」自動配置＝重ならない別ボックス**（#530・#533 レビュー P1）。`layout` が `subtitleSegment.parallelLineIds` から帯を積む（段間 `SUBTITLE_STACK_STEP_EM`＝1行帯＋余白）。`sceneSegmentSpecs.subtitleText` は **primary のみ**（同時行は `parallelLineIds`）。FREE `allLines` は primary＋同時行を `\n` 結合（`resolveSubtitleForElement`＋`wrapText` の `\n`）、FREE `speaker` は自分の話者行だけ。テンプレ字幕は下端基準（`anchorBottom`）で複数行でも画面外に出さない。preview=export は共有 `layoutScene`（`subtitleSegment` 配線）でパリティ。
- `SceneEditScreen`：2人目以降の行に「前のセリフと同時に流す」トグル（ON で `startSec` を隠す・Undo 可）。
- 正典：**`11` の V18 は改定不要**（フラグ方式は startSec を保存しない）＝V18 に対象外の注記のみ追記。並行音声は ADR-0024 で α-5（amix パス新設が前提）としていたのを A の範囲で α-4（0.4.2）へ前倒し。

## 確定（実装 2026-07-15）と残論点
**確定（実装済み）**
- **V18 は改定不要**（🔴 指摘の解消）：フラグ方式は `startSec` を保存しないので V18（保存された startSec の重複）に触れない＝既存プロジェクトの補正誤爆も起きない。11 §8 の V18 に「`startWithPrevious` の行は対象外」の注記のみ。
- **モデル＝フラグ**（`NarrationLine.startWithPrevious?`・利用者決定 2026-07-15）。
- **上限＝N 人**（2人固定でなく `true` の連続で N・利用者決定）。
- **既存消費者の影響**：`lineSegments`（単独行は不変）・`compileTimeline`（zip 維持＝同時行は同一窓の重なりクリップとして射影＝読み取りUIでは重なり表示＝意味的に正しい）・字幕解決（`segmentLineIds` 経由）・動画区間（`narrationSegments` amix）を洗い出し済み。パリティは共有 `sceneSegmentSpecs`/`layoutScene` で維持（回帰テスト緑）。
- **字幕2段（利用者決定 2026-07-15＝自動2ボックス）**：通常テンプレの自動字幕は**2人目以降を上へ自動配置**（重ならない別ボックス・#530 文面どおり）。当初 `\n` 2行結合で出したが #533 レビューで #530 スコープとの差を指摘され、利用者が「2つ目の字幕欄を自動配置」を選択（本 PR で実装）。話者ごとの手動配置は引き続き ADR-0029 の `subtitleSource={kind:'speaker'}`（FREE ボックス）で可能。
- **amix**：`mix_narrations`（unit gain・場面 narration_volume は下流で1回）／動画経路は既存 `narrationSegments` amix を流用。#259 ノーマライズは将来。

**残論点（α-5・別途）**
- **開始オフセット**（「2つ目を◯秒ずらす」）・多トラックドラッグ＝統合タイムライン（ADR-0023・#258）。
- **同時発話の音量バランス**（話者ごとの相対音量）＝現状は場面 narration_volume 共有（scope A）。#259 と併せて検討。
- **読み取りタイムライン（`compileTimeline`）の並行表示**＝現状は同一トラックの重なりクリップ。多トラック分離は α-5。
- **掛け合い×動画×アニメ**は #469 で静止に倒れており対象外（本 ADR も静止のまま）。
