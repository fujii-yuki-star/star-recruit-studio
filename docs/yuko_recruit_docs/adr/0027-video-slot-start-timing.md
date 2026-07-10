# ADR-0027: 動画スロット本体アニメの再生開始タイミング（同時／途中／アニメ後）

- **状態**: Proposed（設計。承認後に実装＝schema 1.18＋書き出し＋UI）
- **日付**: 2026-07-10
- **関連**: #444 / [`0026`](0026-alpha4-behavior-consistency.md)（決定6・動画×アニメ除外の解除＝#442）/ [`0019`](0019-keyframe-animation-model.md)（per-frame・アニメモデル）/ [`0001`](0001-rendering-parity.md)（プレビュー=書き出しパリティ）/ [`0018`](0018-cross-scene-timeline-model.md)（`timelineOverlay.animations`）/ [`0024`](0024-non-destructive-editing-model.md)（将来 `scene.slotClips`）/ `CLAUDE.md §2-3`（技術用語）/ `§2-4`（テンプレ駆動）/ `§2-7`（定数の単一参照）/ `11 §7.1`（Scene schema）/ `schemas/project.schema.json`（1.17→1.18）

---

## コンテキスト

#442（ADR-0026 決定6）で**動画スロット本体アニメ**を実フレーム合成で対応した。アニメのある区間（窓 `[0, W]`・`W = animEnd`）は毎フレーム動画の実フレームを合成し（動きながら再生）、以降の settled 区間は最終位置で実動画を流す。この時の**再生開始は「アニメと同時・先頭から」に固定**されている（`buildExportScenes` の窓経路：窓フレーム `f` に対し clip フレーム `min(f, count-1)` を割り当て、settled は `clipStart + W*speed` から連続）。

利用者要望は「**動画の再生開始タイミングに自由度を持たせたい**」＝

1. 動画スタート = アニメスタート（同時・#442 既定）
2. 動画スタート = アニメ終了（アニメ区間は代表フレームで待ち、settled から再生）
3. **アニメの途中から**動画再生（連続値の遅延）

これは **(場面, スロット) 固有**の設定であり（同じ動画でも場面ごとに別タイミングで使いたい）、保存には schema へのフィールド追加が要る。CLAUDE.md §9-2「勝手にフィールドを増やさない」に従い ADR を先に起こす。

## 判断軸

- **テンプレ駆動・非技術者UX**（§2-3/§2-4）＝UI に秒やフレームの技術語を出さず「アニメと同時／アニメの後／途中から」で選ばせる。
- **正典の単一参照・定数**（§2-7）＝新規マジック数を作らない（下限0・上限は `animEnd` の派生）。
- **プレビュー=書き出しパリティ**（ADR-0001）＝開始タイミングは preview（#432 実再生）と export で同一に反映。
- **後方互換**＝既存プロジェクトを無変換で読める（欠落＝現行の「同時」）。
- **#442 の実フレーム機構を再利用**＝新しい書き出しパイプラインを増やさない（窓分割・settled・元音声 amix を流用）。

## 検討した選択肢

### 保存先（どこに持つか）

| 選択肢 | 評価 |
|---|---|
| **(A) `scene.slotVideoStartDelays: Record<layerId, 秒>`**（`slotFits` 同型の場面×スロット上書き） | **採用**。additive・後方互換・`slotFits`/`textFontIds` の実績パターン。ADR-0024 の `slotClips` 確定を待たずに α-4 で出荷可。 |
| (B) ADR-0024 の `scene.slotClips`（仮）に畳む | `slotClips` は**未確定（Proposed）＝ブロッカー**。将来 `slotClips` 導入時に (A) を統合できる（移行は `slotClips` PR で）。 |
| (C) `Asset.clip`（グローバル）に持たせる | 却下。**per-use でない**＝同じ動画を場面ごとに別タイミングで使えない。ADR-0024 の非破壊（使用単位＝範囲参照）方針にも反する。 |

### 値の意味（何を保存するか）

| 選択肢 | 評価 |
|---|---|
| **絶対 scene 秒（≥0）を保存し、描画で `[0, animEnd]` にクランプ** | **採用**。`lines[].startSec` 等と同じ流儀。アニメを縮めても端で安全に劣化（クランプ）。 |
| 0..1 の正規化（W に対する割合） | 却下。`W`（=animEnd）依存で直感的でなく、`W` 変化時の意味が不安定。 |

## 決定（Proposed）

1. **schema**：`Scene` に `slotVideoStartDelays?: Record<string, number>`（キー＝テンプレのスロット `layer.id`、値＝**再生開始の遅延秒 ≥0**）を**任意追加**。未指定／`0` = #442 既定（アニメと同時・先頭から）。`project.schema` を **1.17→1.18**（additive・**データ変換不要**＝欠落は 0 とみなす）。
2. **意味論**（`d` = そのスロットの遅延秒、`W` = animEnd、描画時に `d ← clamp(d, 0, W)`）：
   - 窓 `[0, d]`：**代表フレーム（`clipStart` のフレーム）で静止**して待つ。
   - 窓 `[d, W]`：clip を `clipStart` から再生（窓フレーム `f` に clip フレーム `f − round(d*fps)` を割り当て、下限0）。
   - settled `[W, 尺]`：**窓の続き**＝`clipStart + (W − d)*speed` から連続再生（`d = W` なら `clipStart` のまま＝待って settled から再生）。
   - 元音声（`clipAudio`）：scene-time `d` から鳴らし、尺は `min(W − d, 残り再生秒)`。
3. **適用範囲**：**アニメ対象の動画スロットのみ**有効（窓が無いスロット＝アニメ無しは従来どおり全尺 `clipStart` から再生。`slotVideoStartDelays` は無視）。
4. **UI**（場面編集・動画スロット設定内。§2-3 技術用語なし）：「**動画の再生開始**」＝「**アニメと同時**」（d=0）／「**アニメの後**」（d=W）／「**途中から**」（0<d<W・0〜アニメ長のスライダー）の3択。タイムライン側（ADR-0023）は α-5 で合流。
5. **パリティ**（ADR-0001）：preview（#432 の動画実再生）と export で**同じ開始タイミング**を反映（窓分割ロジックを共有）。

## 結果・影響

- **正典/schema**：`schemas/project.schema.json` に `slotVideoStartDelays`（optional・`additionalProperties: { type: number, minimum: 0 }`）を追加し `schemaVersion` を **1.18** へ。`11 §7.1` の Scene 表と §2.x（schema 1.18）に1行追記。domain `Scene` 型（`src/domain/project/types.ts`）に追加。**マイグレーションは不要**（欠落＝0＝同時。既存データは読み替えのみ）。
- **書き出し**（`buildExportScenes`・#442 窓経路）：窓 per-frame の clip-frame 参照を `d` で分岐（`t<d` は frame0 保持／`t≥d` は `f − round(d*fps)`）、抽出尺・settled `clipStart`・窓 `clipAudio` の区間を `d` で調整。**schema 不変の IPC 入力のみ拡張**（`clipAudio` に `delaySec`＝Rust `build_window_audio` の adelay）＝ADR-0026 と同流儀。
- **プレビュー**：#432 の実再生に開始タイミングを反映（合流時）。
- **テスト**（§7）：純粋ロジック＝窓フレームの clip 対応・settled 連続位置・元音声区間の単体テスト（`buildExportScenes.test.ts`）。
- **定数**（§2-7）：新規マジック数なし（下限0・上限は `animEnd` 派生）。UI のスライダー上限も `animEnd` から算出。

## 未解決の論点

- **UI の最終アフォーダンス**：まず3択（同時／アニメの後／途中＝秒スライダー）で出す。「途中＝秒指定」を初回に含めるか、まず2択（同時／アニメの後）で出して秒指定を後続にするかは**利用者確認**。
- **`clipAudio.delaySec` の Rust 実装詳細**（`build_window_audio` の adelay 合成）。IPC 入力拡張のみ（schema 不変）。
- **掛け合い×動画×アニメの複合**時の窓定義（#442 の主対象は非掛け合いの動画本体アニメ）。掛け合いセグメントを跨ぐ場合の `d` の基準は実装時に確定（要確認）。
- 将来 ADR-0024 `scene.slotClips` 導入時に `slotVideoStartDelays` を統合するか（移行方針は `slotClips` PR で）。
