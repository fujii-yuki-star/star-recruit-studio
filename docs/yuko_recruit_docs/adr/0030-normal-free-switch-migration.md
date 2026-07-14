# ADR-0030: 通常↔FREE 切替の非破壊コンテンツ移送（freeLayout の seed と休眠）

- **状態**: Accepted
- **日付**: 2026-07-14
- **関連**: `CLAUDE.md §2-2/§2-4` / [`ADR-0008`](0008-free-layout-editor.md)（自由配置＝`scene.freeLayout`） / [`ADR-0024`](0024-non-destructive-editing-model.md)（非破壊） / `#236`（切替の清算ポリシー） / `11_SCHEMA_REFERENCE.md`（freeLayout の正典） / PR #524（FREE 全場面化）レビュー P1/P2

## コンテキスト
PR #524 で「見た目ピッカーは全場面で FREE を候補に出し、選ぶと FREE 化」を実装したが、レビューで切替時のデータ移送が欠けていた:

- **[P1] 通常→FREE で素材配置が無言で失われる**：`switchSceneTemplate`（`sceneOps.ts`）は `assetRefs` を新テンプレのスロット id 集合へ清算する（#236）。FREE テンプレ（`free_canvas_v1`）は `background/slot/logo` レイヤーを持たないため、**通常場面の写真・動画（assetRefs）が全消去**され、`freeLayout` へも移らない＝プレビュー/書き出しから消える（§2-2 違反）。
- **[P2] FREE→通常で編集不能な `freeLayout` が残る**：`sceneType` は通常カテゴリへ変わるが `freeLayout` は `...scene` で保持される。描画・編集は `template.category===FREE` でゲート済み（`layout.ts:278`／`isFree`）ゆえ無視されるが、**事前確認・素材使用判定（`adapters.ts`）は `freeLayout` の有無で判定**するため、休眠データを検査・使用済みカウントしてしまう。正典（11）は `freeLayout` を `sceneType=free` のみと定義しており食い違う。

## 判断軸
- §2-2 黙ったデータ消失を作らない（切替で内容を消さない）。
- §2-4 テンプレ駆動・ADR-0024 非破壊（保持できるものは保持し、戻せる）。
- パリティ（ADR-0001）：描画は共有 `layoutScene` を不変に保つ（実効表現のみ描く）。
- 既存ポリシー #236 との一貫性（`texts`/`textFontIds` は切替でも保持＝休眠し、戻すと復元される）。

## 検討した選択肢
| 選択肢 | 評価 |
|---|---|
| **A 非破壊・往復可（採用）** | 通常→FREE は表示中の内容を `freeLayout` へ自動変換（seed）。FREE→通常は `freeLayout` を休眠保持し、描画/編集/事前確認/素材使用は「実効表現（テンプレ category）」だけを対象にする。`texts` 休眠（#236）の自然な延長。往復で自由配置が戻る。 |
| B 確認式・破棄 | 変換は確認、FREE→通常で `freeLayout` を破棄。正典クリーンだが往復で自由配置が消える。 |
| C スコープ縮小 | 通常↔FREE 直接切替を 0.4.2 で見送り。#524 の狙い（FREE 全場面化）を後退させる。 |

## 決定（A・利用者決定 2026-07-14／#524 再レビューで変換対象を拡張）
1. **通常→FREE で「表示中の内容」を余さず `freeLayout` へ seed する**（純粋関数 `freeLayoutFromPlacedContent(scene, prevTemplate)`）。旧テンプレのレイヤー幾何（`x/y/w/h/rotation/zIndex`）を引き継ぎ、次を FreeElement へ変換（表示されていないものは持ち込まない）:
   - **スロット層（`assetRefs`）→ slot 要素**。**動画クリップ調整（`slotClips`）は旧層 id → 新 FREE 要素 id へ移送**（範囲/速度/元音声が黙って素材既定へ戻らない・#524 P1）。
   - **立ち絵層（`scene.character.poseAssetId`）→ slot 要素（画像）**。FREE で見えて自由に動かせる。`scene.character` は休眠保持（往復で戻る・#524 P1）。
   - **文字層（`texts`）→ text 要素**。
   - **字幕層 → subtitle 要素**（`subtitleSource`＝単独 `narration`／掛け合い `allLines`＝`defaultSubtitleSource`・ADR-0029）。字幕が出る場面のみ（#524 P1）。
   `freeLayout` が空のときだけ seed し、既存の自由配置は上書きしない。`assetRefs`/`slotFits` は #236 どおり清算＝内容は `freeLayout` に移る（単一の源）。
2. **FREE→通常は `freeLayout` を休眠保持**（従来どおり `...scene`）。**描画・編集は既に category でゲート済み**。**事前確認・逆引き（使用場面）・削除確認の「実効使用」判定を共通化**（`sceneActiveAssetIds(scene, template)`＝FREE 場面は `freeLayout[].assetId`／通常場面は `assetRefs`＋`character.poseAssetId`）＝休眠側を検査・誤カウント・誤表示しない（P2 解消・`adapters.ts`／`assetUsage.ts`）。
3. **往復**：FREE→通常→FREE は休眠 `freeLayout` が戻る。通常→FREE は内容を `freeLayout` へ移す片道変換（戻すと通常スロットは空・内容は FREE 側に残る＝データは消えない）。
4. **対象外**：装飾レイヤー（`shape`/背景色）は変換しない（意匠）。字幕の背景帯（`layer.background`）は FreeElement に無く引き継がない（既知の軽微差）。

## 結果・影響
- `src/domain/project/sceneOps.ts`：`freeLayoutFromPlacedContent`（slot/character/text/subtitle＋`slotClips` 移送マップ `{elements, slotClips}` を返す）＋`switchSceneTemplate` に `prevTemplate?` 引数・seed・`slotClips` マージ。
- `src/domain/project/assetUsage.ts`：`sceneActiveAssetIds`（実効テンプレでゲート）を新設し `sceneUsesAsset`/`scenesUsingAsset` を template 受け取りへ。`adapters.ts`（precheck）と `MaterialsScreen.tsx`（逆引き/削除確認）が同一規則を共有。
- `src/app/screens/SceneEditScreen.tsx`：ピッカー onChange で旧テンプレ（`s.templateId` 解決）を `switchSceneTemplate` へ渡す。
- **正典**：`11_SCHEMA_REFERENCE.md` に「`freeLayout` は任意 `sceneType` に存在しうる（**有効なのは FREE テンプレのときだけ＝それ以外は休眠**）」を明記。#236 の非対称（`texts` は保持）を `freeLayout`/`assetRefs` にも広げる読み。**schema 据え置き**（`freeLayout` は enum 条件を課さない任意フィールド＝`project.schema` の版は変えない）。
- テスト：通常→FREE の素材/収め方/回転/`slotClips`/立ち絵/字幕（単独=narration・掛け合い=allLines）変換、休眠 `freeLayout`・assetRefs・character が precheck/逆引きに出ないこと。

## 未解決の論点
- 通常→FREE→通常で通常スロットを復元するか（現状は片道。必要なら `assetRefs` も休眠保持へ拡張＝#236 の再検討・**要ユーザー確認**）。
- 字幕の背景帯（`layer.background`）の FREE への持ち込み（FreeElement に背景帯フィールドが無い＝軽微・別途）。
