# ADR-0028: 動画クリップ調整を「場面×スロットの per-use 上書き（scene.slotClips）」にして Undo 可能にする

- **状態**: Accepted（2026-07-11 利用者承認。per-use の挙動変化は「一旦この方針で決定・指摘が上がれば再検討」）
- **日付**: 2026-07-11
- **関連**: #472 / [`0024`](0024-non-destructive-editing-model.md)（非破壊編集モデル・決定1＝`scene.slotClips` の per-use 上書きを採用済／本ADRはその**フィールド構成と継承規則を確定**＝ADR-0024 未解決#1）/ [`0020`](0020-undo-redo-model.md)（Undo 履歴 slice＝`meta/parts/scenes`・`assets` は除外）/ [`0007`](0007-detailed-edit-mode.md)（クリップ調整 Phase 3b）/ `CLAUDE.md §5`（null=継承・`11 §6`）/ `§2-7`（正典の単一参照）/ `11 §7.1`（Scene schema）/ `schemas/project.schema.json`

---

## コンテキスト

動画クリップ調整（`ClipDetailControls`：使う範囲 `startSec/endSec`・再生速度 `speed`・元音声の ON/音量 `useOriginalAudio/originalAudioVolume`）は **`asset.clip`（assets）** を更新する。一方 **ADR-0020 の Undo 履歴 slice は `meta/parts/scenes` のみで `assets` は対象外**（素材取込のディスクIO＋transient src ＋ dangling 回避のため意図的に除外）。そのため、これらの調整は **Undo/Redo で戻せない**（#472）。#389 で `ClipDetailControls` のスライダーに履歴グループを付けたが、更新先が履歴対象外で無意味と判明し外した経緯がある。

一方 **ADR-0024（Accepted）決定1** は「動画スロットの再生範囲等は `scene.slotFits` と同型の **場面×スロット上書き（例 `scene.slotClips`）** に載せ、`Asset.clip` は既定値として残す（null=継承）」と**方向を確定済み**（未解決#1＝フィールド構成と継承規則は実装PRで確定）。本 ADR はこの未解決を確定し、#472 の Undo を**その帰結として**得る。

**要点**：クリップ調整を**場面（scenes）に載せれば、ADR-0020 の履歴が scenes を snapshot するので自動的に Undo 可能**になり、かつ ADR-0024 の per-use（同じ動画を場面ごとに別範囲で使う）も同時に得られる。`assets` を履歴へ含める必要はない。

## 判断軸

- **ADR-0020 の assets 除外理由を尊重**（disk IO・dangling 回避）＝assets を履歴に入れない。
- **ADR-0024 の per-use 方向に準拠**（`slotFits` 1.13 の先例・null=継承 `11 §6`）。
- **後方互換**（additive・欠落=`asset.clip` 継承＝現行挙動・無変換移行）。
- **描画/書き出しは単一経路**（`findVideoSlots` に per-use 解決を1か所足すだけ・preview=export 不変）。
- **§7 テスト**（継承解決・per-use 独立を純粋ロジックで固定）。

## 検討した選択肢

| 選択肢 | 評価 |
|---|---|
| **(A) `scene.slotClips` per-use 上書き（ADR-0024 決定1 準拠）** | **採用**。クリップ調整が場面編集＝ADR-0020 履歴で**自動 Undo**。per-use（場面ごと別範囲）も得る。`slotFits` 同型・additive・null=継承。`Asset.clip` は既定として残す。 |
| (B) `assets`（または `asset.clip` 差分）を Undo 履歴 slice に含める | 却下。ADR-0020 が assets を除外した理由（disk IO・素材取込を跨ぐ履歴保持・dangling 回避）に反する。`asset.clip` だけ部分 snapshot する変種も履歴モデルに例外を持ち込み複雑。 |
| (C) クリップ設定専用の別 Undo スタック | 却下。ADR-0020 の**単一スナップショット履歴**を壊す（2系統の履歴・Ctrl+Z の一貫性喪失）。 |

## 決定

### D1. schema：`scene.slotClips`

`Scene` に **`slotClips?: Record<string, SlotClipOverride>`**（キー＝テンプレのスロット `layer.id`、`slotFits` 同型）を任意追加。

- `SlotClipOverride = { startSec?, endSec?, speed?, useOriginalAudio?, originalAudioVolume? }`（`Clip` の**per-use 上書き可能な部分集合**）。
- **`fit` は含めない**：収め方は既に `scene.slotFits`（1.13）で per-use かつ Undo 可能ゆえ、本 ADR の対象外（二重管理を避ける）。#472 が戻せない範囲＝range/speed/元音声のみを `slotClips` が担う。
- `project.schema` を **1.18→1.19（マイナーバンプ）**（additive・**移行不要**＝欠落は `asset.clip` を継承）。

### D2. 継承規則（null=継承・`11 §6` 流儀）

描画/書き出しの実効クリップ設定は **`scene.slotClips[layerId]?.field ?? asset.clip?.field ?? 既定`**。`Asset.clip` は**素材の既定値**として残す（AI・取込・素材画面が設定）。場面側に上書きが無いフィールドは既定を継承。

### D3. 役割分担（どこで何を編集するか）

- **場面編集（SceneEditScreen）の `ClipDetailControls`**：`scene.slotClips[layerId]` を編集＝**その場面だけの per-use 上書き**。scenes 更新ゆえ**Undo 対象**。連続操作（スライダー drag）は `useHistoryGroup` の drag 境界で1手に合成（#389 で外した履歴グループを、意味を持つ形で復活）。
  - **初期表示は継承値のプレースホルダ（決定・実装必須）**：slotClips が空でも `ClipDetailControls` は**継承値（`asset.clip`＝素材の既定）をプレースホルダ表示**し、値を触った時点で slotClips へ確定する。既定値（範囲=全体・速度=1.0）を表示すると「素材で調整した内容が場面で消えた」誤認を生む（実際は継承で効いている）ため出さない（slotVideoStart の delaySec 既定表示 #500 と同配慮）。
- **素材画面（MaterialsScreen）の `ClipDetailControls`**：`asset.clip`（**素材の既定**）を編集＝全使用箇所の既定。素材プロパティゆえ従来どおり**Undo 対象外**（取込/削除と同じ）。**同一部品で Undo 挙動が分岐する**ため、素材画面側に §2-5 で「**ここでの変更は元に戻せません（この素材を使う全場面の既定が変わります）**」を明示する（決定・実装必須＝「Ctrl+Z が効いたり効かなかったり」の誤認を防ぐ）。

### D4. 描画/書き出し

`findVideoSlots`（`toVideoSlotInfo`）が `asset.clip` から `VideoSlotInfo` を組む箇所に、**`scene.slotClips[layerId]` を重ねる**（per-use 優先＝`resolveSlotClip`）。1か所の解決追加で preview（#432）/書き出し（buildExportScenes）/precheck が同一値を見る（パリティ不変）。

**解決順序（重要）**：per-use 解決は **`VideoSlotInfo` 組み立て時に一括**し、#500（ADR-0027）の窓/settled/遅延計算（`clipTimeAtSceneTime(t,{d,c,s})`・`resolveVideoStartDelaySec`・settled 開始 `clipStart+(W−d)·speed`）は**解決後の `speed`/`clipStart`/`clipEnd` のみ参照**する。`speed`/`startSec`/`endSec` は slotClips で per-use 上書きされるため、旧値（素材既定）で窓を計算すると「場面で速度を変えたのに開始タイミングの窓が旧速度」＝設定不効／プレビュー≠書き出しになる。実装は「slotClips 解決 → VideoSlotInfo → 以降の全計算はその VideoSlotInfo を入力」の一方向に保つ。

### D5. Undo

新規の Undo 機構は不要＝`slotClips` が `scenes` 上にあるので**ADR-0020 の履歴で自動的に Undo/Redo**される。`ClipDetailControls`（場面側）の drag に履歴グループを再付与するだけ。

### D6. per-use マップの共通ライフサイクル（3マップ）

scene の per-use 上書きは **`slotFits`（1.13）／`slotVideoStart`（1.18・#500）／`slotClips`（1.19・本ADR）の3マップ**（いずれもキー＝スロット `layer.id`）に増える。**キーとライフサイクルは3マップ共通規則**とする：

- **スロットが消滅したら3マップとも当該キーを掃除**（FREE スロット要素の削除・スロット非割当・素材差し替えでスロットでなくなる 等）。
- **場面複製時は3マップとも複製**する。
- **要素の複製・コピー/貼り付け時も3マップとも運ぶ**（#770 で追記）＝運ばないと**複製した瞬間に設定が落ちた別物**ができる（使う範囲・速度・再生の開始タイミング・収め方が既定へ戻る）。掃除だけを共通化して複製を各画面に任せると、**同じ概念の片側だけ**が面倒を見られる（ADR-0026②）。

#500 で `slotVideoStart` のエントリ生存条件（`slotIsAnimated` ゲート・アニメ解除時の破棄）が UI/プレビュー/書き出し/precheck の4経路で揃わず破綻した轍を踏まないため、掃除/複製は**3マップ共通のヘルパ1か所**で行う。将来 per-use マップを増やすときも同ヘルパに足す。
  - **確定（#551・PR #566）**＝掃除は `prunePerUseMaps(scene, removedIds)`（`src/domain/project/perUseMaps.ts`）。FREE 要素の削除3経路（単体／一括／グループを中身ごと）が呼ぶ。
    **なぜ必須か**＝`createFreeElementId` は**歯抜けの最小番号を再利用する**ため、孤児エントリは休眠で済まない：`free_002` を消して残った `slotClips.free_002` は次に発行された別の `free_002` へ**憑依**し、「設定した覚えのない範囲/速度/再生開始が黙って効く」（ADR-0026① の裏面）。
  - **確定（#770・複製側）**＝**取り出す `perUseEntriesFor(scene, id)` ＋ 入れる `withPerUseEntries(scene, id, entries)`**（同 file）。2つに割るのは、**コピー/貼り付けが場面をまたぐ**ため＝貼るときには元の場面をたどれない。よって**コピーを押した時点で取り出して控える**（要素そのものを控えるのと同じ扱い＝元を消してから貼っても中身が揃う）。同じ場面の複製は取り出す→入れるを続けて呼ぶ。
    **`slotVideoStart` も運ぶ**＝この上書きは**動きのあるスロットでだけ効く**（ADR-0027・`slotIsAnimated`）が、複製では**動きも一緒に運ぶ**ので、効かないエントリだけが増えることはない。
    **入れないマップは消す**＝入れた後の新 id のキー集合を、取り出したもの（`entries`）と**必ず一致**させる（新 id は未使用ゆえ、そこに残るエントリは定義上すべて孤児＝複製にだけ憑依する）。
    **「増やすときも同ヘルパに足す」の守り方**＝顔ぶれの表 `PER_USE_MAP_KEYS`（`Record<keyof PerUseMaps, true>`）を置き、マップを1本足すと**そこがコンパイルエラー**になる。⚠️ **型だけでは足りない**＝`Scene` の各マップは任意（`?`）なので、3関数のどれか1つが足し忘れても戻り型は通る（**複製で1本だけ黙って落ちる**）。よって**表を回すテスト**（`perUseMaps.test.ts`）で「落とす・取り出す→入れる」の全部が全キーを面倒みることを確かめる。

## 結果・影響

- **正典/schema**：`schemas/project.schema.json` に `slotClips`（`SlotClipOverride` 定義・`additionalProperties:false`・`startSec/endSec/speed/useOriginalAudio/originalAudioVolume`）を追加、`schemaVersion` **1.18→1.19（マイナーバンプ）**、`persistence.ts` の `PROJECT_SCHEMA_VERSION` と版履歴、`11 §7.1` の Scene 表を更新。domain `Scene` 型に追加。**マイグレーション不要**（欠落＝`asset.clip` 継承＝現行）。
- **domain**：per-use 解決の純粋関数（例 `resolveSlotClip(scene, layerId, asset)`＝`slotClips ?? asset.clip ?? 既定`）を新設し、`findVideoSlots`/`ClipDetailControls`/表示が共有（§2-7 単一参照）。
- **UI**：`ClipDetailControls` を「編集先」で分岐（場面側＝slotClips・素材側＝asset.clip）。場面側 drag に履歴グループ復活（#389 の巻き戻し）。§2-3 技術用語なし・文言は「この場面での使い方」等。
- **描画/書き出し**：`findVideoSlots` の per-use 解決追加のみ。preview=export 不変。
- **テスト**（§7）：継承解決（per-use 上書き有/無・部分上書き）・per-use 独立（同一素材を2場面で別設定）・Undo（scenes 履歴で戻る）・schema 正常/異常（ajv）。
- **挙動変化（明示）**：**同じ動画を複数場面で使う場合、クリップ調整が「場面ごと独立」になる**（現行は `asset.clip` グローバルで全場面連動）。1場面のみで使う一般ケースは不可視。per-use はむしろ ADR-0024 が狙う利点だが、UX 上は「この場面だけ」を文言で明示する。

## 未解決の論点

（初期表示のプレースホルダ＝D3・素材画面の §2-5 明示＝D3・3マップのライフサイクル＝D6・解決順序＝D4 は**決定側に格上げ済み**＝#472 レビュー反映。以下は実装で細部を詰める点。）

- **`fit` の扱い**：現状 `slotFits` と `slotClips` が別マップ（per-use は3マップ）。将来 `slotClips` に一本化するかは別途（本 ADR は additive を優先し slotFits 据え置き・D6 の共通ライフサイクルで足並みは揃える）。
- **crop/reframe 等の拡張**（ADR-0024 の将来枠）：`SlotClipOverride` にフィールド追加で後付け（schema マイナーバンプ）。
- **導線文言の具体化**（§2-3）：「素材の既定に合わせる／この場面だけ変える」等の場面側UI文言は実装で確定。
