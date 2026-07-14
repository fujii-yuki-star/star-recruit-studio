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

## 決定（A・利用者決定 2026-07-14）
1. **通常→FREE で `freeLayout` を seed する**：旧テンプレのレイヤー幾何（`x/y/w/h/rotation/zIndex`）を引き継ぎ、**スロット層に置かれた素材（`assetRefs`）と文字層のテキスト（`texts`）を FreeElement（`slot`/`text`）へ変換**する。`freeLayout` が空のときだけ seed し、既存の自由配置は上書きしない。`assetRefs`/`slotFits` は #236 どおり清算＝内容は `freeLayout` に移る（単一の源）。純粋関数 `freeLayoutFromPlacedContent(scene, prevTemplate)`。
2. **FREE→通常は `freeLayout` を休眠保持**（従来どおり `...scene`）。**描画・編集は既に category でゲート済み**。**事前確認・素材使用判定も「実際に FREE の場面（`templateOf(s).category===free`）」だけを対象**にする（`adapters.ts`）＝休眠 `freeLayout` を検査・誤カウントしない（P2 解消）。
3. **往復**：FREE→通常→FREE は休眠 `freeLayout` が戻る。通常→FREE は内容を `freeLayout` へ移す片道変換（戻すと通常スロットは空・内容は FREE 側に残る＝データは消えない）。
4. **対象外**：立ち絵（`scene.character`）と装飾レイヤー（`shape`/背景色）は変換しない（データは `...scene` で保持・意匠/character は別課題）。

## 結果・影響
- `src/domain/project/sceneOps.ts`：`freeLayoutFromPlacedContent` 追加＋`switchSceneTemplate` に `prevTemplate?` 引数と seed 分岐。
- `src/app/adapters.ts`：`buildPrecheckItems` の「使っていない素材」「自由配置の確認」を実効表現（category）でゲート。
- `src/app/screens/SceneEditScreen.tsx`：ピッカー onChange で旧テンプレ（`s.templateId` 解決）を `switchSceneTemplate` へ渡す。
- **正典**：`11_SCHEMA_REFERENCE.md` に「`freeLayout` は任意 `sceneType` に存在しうる（**有効なのは FREE テンプレのときだけ＝それ以外は休眠**）」を明記。#236 の非対称（`texts` は保持）を `freeLayout`/`assetRefs` にも広げる読み。**schema 据え置き**（`freeLayout` は enum 条件を課さない任意フィールド＝`project.schema` の版は変えない）。
- テスト：通常→FREE→通常の素材/収め方/回転の固定、休眠 `freeLayout` が precheck・使用判定に出ないこと。

## 未解決の論点
- 立ち絵（character）の FREE 変換／FREE の character 表示（別課題）。
- 通常→FREE→通常で通常スロットを復元するか（現状は片道。必要なら `assetRefs` も休眠保持へ拡張＝#236 の再検討・**要ユーザー確認**）。
