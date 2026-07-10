# ADR-0027: 動画スロット本体アニメの再生開始タイミング（同時／途中／アニメ後）

- **状態**: Accepted（2026-07-10 利用者承認。実装は段階＝schema 1.18〔本PR〕→書き出し→UI）
- **日付**: 2026-07-10
- **関連**: #444 / [`0026`](0026-alpha4-behavior-consistency.md)（決定6・動画×アニメ除外の解除＝#442／判断軸①②③④）/ [`0019`](0019-keyframe-animation-model.md)（per-frame・アニメモデル）/ [`0001`](0001-rendering-parity.md)（プレビュー=書き出しパリティ・共有純粋関数）/ [`0018`](0018-cross-scene-timeline-model.md)（`timelineOverlay.animations`）/ [`0024`](0024-non-destructive-editing-model.md)（将来 `scene.slotClips`）/ #469（掛け合い×動画のアニメ抑止）/ `CLAUDE.md §2-3`（技術用語）/ `§2-5`（次の行動）/ `§2-7`（定数の単一参照）/ `§9-2`（enum は ADR で正典化）/ `11 §7.1`（Scene schema）/ `schemas/project.schema.json`（1.17→1.18）

---

## コンテキスト

#442（ADR-0026 決定6）で**動画スロット本体アニメ**を実フレーム合成で対応した。アニメのある区間（窓 `[0, W]`・`W = min(場面尺, animEnd)`＝`buildExportScenes.ts` の `hasSettled = W < 尺`）は毎フレーム動画の実フレームを合成し（動きながら再生）、settled 区間は最終位置で実動画を流す。この時の**再生開始は「アニメと同時・先頭から」に固定**されている（窓フレーム `f` に clip フレーム `min(f, count-1)`、settled は `clipStart + W*speed` から連続）。

利用者要望は「**動画の再生開始タイミングに自由度を持たせたい**」＝(1) アニメと**同時**（#442 既定）／(2) アニメ**終了後**（アニメ区間は代表フレームで待ち、settled から再生）／(3) アニメの**途中から**（遅延を秒で指定）。

これは **(場面, スロット) 固有**の設定であり（同じ動画でも場面ごとに別タイミングで使いたい）、保存には schema へのフィールド追加が要る。CLAUDE.md §9-2「勝手にフィールド／enum を増やさない（enum の正典化は ADR の役目）」に従い、コードより先に本 ADR を起こす。

## 判断軸

- **設定した意味どおり**（ADR-0026 ①）＝選んだモードが、**アニメを後で編集しても勝手に別の意味に化けない**こと。
- **黙って無視／黙って静止画にしない**（ADR-0026 ②④・§2-5）＝効かない設定は UI に出さず、理由と次の行動を示す。
- **非技術者UX**（§2-3）＝UI に秒/フレームの技術語を出さず「アニメと同時／アニメの後／途中から」で選ばせる。
- **プレビュー=書き出しパリティ**（ADR-0001）＝開始タイミングは preview（#432 実再生）と export で**同一の純粋関数**を共有して決める（`sceneAnimationActive` と同じ流儀）。
- **正典の単一参照・定数**（§2-7）＝新規マジック数を作らない（下限0・上限は `animEnd` 派生）。enum は正典化。
- **後方互換**＝既存プロジェクトを無変換で読める（欠落＝現行の「同時」）。
- **#442 の実フレーム機構を再利用**＝新パイプラインを増やさない（窓分割・settled・元音声 amix を流用）。

## 検討した選択肢

### 保存先（どこに持つか）

| 選択肢 | 評価 |
|---|---|
| **(A) `scene.slotVideoStart: Record<layerId, spec>`**（`slotFits` 同型の場面×スロット上書き） | **採用**。additive・後方互換・`slotFits`/`textFontIds` の実績パターン。ADR-0024 の `slotClips` 確定を待たずに α-4 で出荷可。 |
| (B) ADR-0024 の `scene.slotClips`（仮）に畳む | `slotClips` は**未確定（Proposed）＝ブロッカー**。将来 `slotClips` 導入時に (A) を統合できる（移行は `slotClips` PR で）。 |
| (C) `Asset.clip`（グローバル）に持たせる | 却下。**per-use でない**＝同じ動画を場面ごとに別タイミングで使えない。ADR-0024 の非破壊（使用単位＝範囲参照）方針にも反する。 |

### 何を保存するか（値の表現）★P1 の核

3つの UI モードのうち「同時（d=0）」「アニメの後（d=W）」は **`W`（=animEnd）に対する象徴的アンカー**、「途中から」だけが**具体的な秒**。`W` はアニメのキーフレーム編集で独立に変わる。

| 選択肢 | 評価 |
|---|---|
| (1) 絶対秒 `d` を保存し、描画/UI で `d` と `W` の比較からモードを復元 | **却下**。`W` が変わると保存意図が**黙って別モードに化ける**：「アニメの後」で `d=W=1.0` 保存→アニメを 2.0s に伸ばす→`0<1.0<2.0`＝「途中から」に化ける。「途中から 1.0s」→アニメを 0.8s に縮める→クランプで `d=0.8=W`＝「アニメの後」に化ける（ADR-0026 ① 違反）。安定なのは `d=0` だけ。 |
| (2) 0..1 正規化（`W` に対する割合） | 却下。**具体秒（途中から）を W 依存にしてしまう**（アニメ長を変えると「途中から○秒」の実尺が動く）。名前つきアンカー2つには安定だが、3モード全体では不適。 |
| **(3) モード明示（discriminated）**：`{ mode: withAnim \| afterAnim \| delay, delaySec? }` | **採用**。「アニメの後」はアニメを編集しても**`afterAnim` のまま**（`W` 非依存）。具体秒は `delay` のときだけ `delaySec` が持ち、クランプは**描画時のみ** `[0,W]`。UI 表示と実挙動が一致（保存 `d=2.0/W=1.0` で「途中2.0s」と表示して 1.0s で動く、が起きない）。enum は本 ADR で正典化（§9-2）＝実装は domain 定数 `VIDEO_START_MODE` 経由（§2-7/§6）。 |

## 決定（Proposed）

### D1. schema

`Scene` に **`slotVideoStart?: Record<string, VideoStartSpec>`**（キー＝テンプレのスロット `layer.id`）を任意追加。

- `VideoStartSpec` = `{ mode: VideoStartMode; delaySec?: number }`
- `VideoStartMode` = `'withAnim' | 'afterAnim' | 'delay'`（**enum を正典化**・domain 定数）
  - `withAnim`（**既定＝エントリ欠落時**）：アニメと同時・`clipStart` から（＝現行 #442）。
  - `afterAnim`：アニメ窓の間は代表フレームで待ち、settled から再生。**`W` が変わっても意味不変**。
  - `delay`：`delaySec`（≥0・**mode=delay のときのみ有効**）だけ遅らせて再生。描画時に `[0, W]` へクランプ。
- `project.schema` を **1.17→1.18**（additive・**データ変換不要**＝欠落は `withAnim`）。

### D2. 意味論（描画・preview=export 共有）

そのスロットの遅延秒 `d` をモードから解決する：`withAnim→0`／`afterAnim→W`／`delay→clamp(delaySec, 0, W)`（`W = min(場面尺, animEnd)`）。

**共有純粋関数**（ADR-0019/0022 の「共有 `layoutScene`/`layoutToSvg`」に倣い、機構名でなく関数で固定）：

```
clipTimeAtSceneTime(t, { startDelaySec: d, clipStartSec: c, speed: s }) = c + max(0, t − d) * s
```

- `[0, d]` は `c`（clipStart）に張り付く＝代表フレームで静止／`[d, W]` は `c` から再生。
- settled `[W, 尺]` の開始は `clipTimeAtSceneTime(W) = c + (W − d) * s`（＝現行 `c + W*s` の `d=0` 特殊化＝後方互換）。
- 元音声（`clipAudio`）は scene-time `d` から、尺 `min(W − d, 残り再生秒)`。
- **preview（#432 実 `<video>`）は連続秒でこの clip 時刻へシーク**、**export はこの clip 時刻を fps 格子へ量子化**（窓フレーム `f` → clip フレーム `f − round(d*fps)`・下限0）。`round`/`ceil` は #376 の端点処理（`buildExportScenes.ts` 内コメント）と整合させる（最終フレームが settled に到達する側へ寄せる）。両者が同一 `clipTimeAtSceneTime` を呼ぶことでパリティを構造保証（ADR-0001）。

### D3. 「アニメの後」で再生区間が残らない場合（`W == 尺`・★P2）

アニメが**場面尺いっぱい**（`animEnd ≥ durationSec` ＝ settled 区間なし）の場面で `afterAnim` を選ぶと、窓が場面全体＝全フレーム静止・settled 無し＝**動画が一度も再生されない**（「押せるのに何もしない」）。よって：

- **UI**：`animEnd ≥ 尺` の場面では `afterAnim` を**出さない**。理由＋次の行動を示す（§2-5・#469 の流儀）：例「この場面はアニメが最後まで続くため『アニメの後』は選べません。アニメを短くするか『途中から』でお試しください。」
- **描画**：`delay` は再生区間が残るよう `d < W` にクランプ（少なくとも 1 フレームは再生）。万一 `afterAnim` が保存されたまま後からアニメが場面尺いっぱいに伸びた場合は、**precheck 警告で表面化**（#434 の流儀＝黙って静止画にしない）。

### D4. 適用範囲＝アニメ対象スロットのみ（★P2「黙って無視」の否定）

`slotVideoStart` は**その場面でスロット本体がアニメ対象のとき（`slotIsAnimated()` が true）だけ**効く。

- **UI**：`slotIsAnimated` が false のスロットには開始タイミングUIを**出さない**（窓が無い＝設定しても無意味なため黙殺、ではなく最初から見せない）。#469 が掛け合い×動画で「動き」UI を出さず理由を示すのと同じ流儀。
- **正規化**：スロットのアニメが後で削除されたら、対応する `slotVideoStart` エントリを**落とす**（保存はするが無視、という隠れ状態を作らない＝ADR-0026 ①②）。

### D5. UI（場面編集・動画スロット設定内）

「**動画の再生開始**」＝「**アニメと同時**」（withAnim）／「**アニメの後**」（afterAnim・D3 の条件を満たす場面のみ）／「**途中から**」（delay・0〜アニメ長の秒スライダー）の選択（§2-3 技術用語なし）。タイムライン側（ADR-0023）は α-5 で合流。

## 結果・影響

- **正典/schema**：`schemas/project.schema.json` の `Scene` に `slotVideoStart` を追加（下記記法）し `schemaVersion` を **1.18** へ。`persistence.ts:18` の **`PROJECT_SCHEMA_VERSION` を `'1.18'`** に更新（schema の `const` と一致させないと新規保存が自スキーマ検証に落ちる）。`11 §7.1` の Scene 表と §2.x（schema 1.18・`VIDEO_START_MODE` enum）に追記。domain `Scene` 型と定数モジュールに追加。**マイグレーション不要**（`isSupportedSchemaVersion` は `1.x` を全受容＝`persistence.ts:215`。既存 1.17 は無変換で読め、欠落＝`withAnim`＝現行）。

  ```json
  "slotVideoStart": {
    "type": "object",
    "additionalProperties": {
      "type": "object",
      "additionalProperties": false,
      "required": ["mode"],
      "properties": {
        "mode": { "enum": ["withAnim", "afterAnim", "delay"] },
        "delaySec": { "type": "number", "minimum": 0 }
      }
    }
  }
  ```

- **書き出し**（`buildExportScenes`・#442 窓経路）：窓 per-frame の clip-frame 参照を `clipTimeAtSceneTime` 経由に（`t<d` は frame0 保持／`t≥d` は `f − round(d*fps)`）、抽出尺・settled `clipStart`・窓 `clipAudio` の区間を `d` で調整。**schema 不変の IPC 入力のみ拡張**（`ClipAudioInput` に `delaySec`＝Rust `build_window_audio` の `adelay`。`ffmpeg.rs` に `adelay` 実績あり）＝ADR-0026 と同流儀。
- **プレビュー**：#432 の実再生に同じ `clipTimeAtSceneTime` を反映（合流時）。
- **テスト**（§7）：純粋ロジック＝`clipTimeAtSceneTime`（hold/play/settled 連続）・モード→`d` 解決・`W==尺` クランプ・元音声区間の単体テスト＋schema 正常/異常（ajv）。
- **定数**（§2-7）：新規マジック数なし（下限0・上限は `animEnd` 派生・UI スライダー上限も `animEnd`）。`VIDEO_START_MODE` は domain 定数として単一参照。
- **索引同期**：`adr/README.md`・`CLAUDE.md §11`・**`AGENTS.md §11`**（CLAUDE と同格の正典）に Proposed で1行。※AGENTS.md §11 は 0023〜0026 が未反映のドリフトあり＝**別 Issue でバックフィル**（本 ADR では 0027 の1行のみ両ファイルへ）。

## 未解決の論点

- **初回スコープ**：モード明示保存なので「まず `withAnim`/`afterAnim` の2モード→後で `delay`＋`delaySec` を**additive に追加**」が**ドリフトなしで**成立する（P1 の懸念は保存形式で解消済み）。**3モード全部を初回で出す**（#444 要望どおり・推奨）か、2モード先行かは**利用者確認**。
- **`clipAudio.delaySec` の Rust 実装詳細**（`build_window_audio` の `adelay` 合成順）。IPC 入力拡張のみ（schema 不変）。
- **掛け合い×動画×アニメ**：現状 `sceneAnimationActive`（`sceneAnimation.ts:27`）が `hasVideoSlot && lines>0` を preview/export/UI の3面で静止に倒しており（#469）、**この組み合わせは現在存在しない**＝本 ADR の対象外。**#469 が解除されるときに**、行区間×窓の `d` 基準を別途決める。
- 将来 ADR-0024 `scene.slotClips` 導入時に `slotVideoStart` を統合するか（移行方針は `slotClips` PR で）。アニメ削除時のエントリ落とし（D4）で再追加時に再設定が要る点のUXは実装で確認。
