# ADR-0030: 通常↔FREE 切替の非破壊コンテンツ移送（freeLayout の seed と休眠）

- **状態**: Accepted
- **日付**: 2026-07-14（**決定3 の確認条件を 2026-07-24 に改定＝#547 P2-9／同日 追補6＝通常→通常も非破壊に＝#547 P3-14**）
- **関連**: `CLAUDE.md §2-2/§2-4` / [`ADR-0008`](0008-free-layout-editor.md)（自由配置＝`scene.freeLayout`） / [`ADR-0024`](0024-non-destructive-editing-model.md)（非破壊） / [`ADR-0022`](0022-element-grouping.md)（グループの非表示） / [`ADR-0029`](0029-free-subtitle-multi-and-binding.md)・[`ADR-0031`](0031-simultaneous-dual-voice.md)（字幕の実表示） / `#236`（切替の清算ポリシー） / `11_SCHEMA_REFERENCE.md`（freeLayout の正典） / PR #524（FREE 全場面化）レビュー P1/P2 / #547 P2-9（確認条件の改定）

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
1. **通常→FREE で「表示中の内容」を余さず `freeLayout` へ seed する**（純粋関数 `freeLayoutFromPlacedContent(scene, prevTemplate)`）。旧テンプレの**実効配置**（グループ transform を前合成・非表示グループのメンバーは除外＝通常描画と同じ `composeGroupGeometry`/`isHiddenByGroup`・#524 P1）ごと、次を FreeElement へ変換（表示されていないものは持ち込まない）:
   - **スロット層（`assetRefs`）→ slot 要素**。**動画クリップ調整（`slotClips`）は旧層 id → 新 FREE 要素 id へ移送**（範囲/速度/元音声が黙って素材既定へ戻らない・#524 P1）。
   - **立ち絵層（`scene.character.poseAssetId`）→ slot 要素（画像）**。FREE で見えて自由に動かせる。`scene.character` は休眠保持（往復で戻る・#524 P1）。
   - **文字層（`texts`）→ text 要素**。
   - **字幕層 → subtitle 要素**（`subtitleSource`＝単独 `narration`／掛け合い `allLines`＝`defaultSubtitleSource`・ADR-0029）。字幕が出る場面のみ（#524 P1）。
   `freeLayout` が空のときだけ seed し、既存の自由配置は上書きしない。`assetRefs`/`slotFits` は**清算せず休眠保持**（決定3・追補6）＝FREE で見えるのは `freeLayout` 側（単一の源）で、通常へ戻すと休眠が復元される。
2. **FREE→通常は `freeLayout` を休眠保持**（従来どおり `...scene`）。**描画・編集は既に category でゲート済み**。**事前確認・逆引き（使用場面）・削除確認の「実効使用」判定を共通化**（`sceneActiveAssetIds(scene, template)`＝FREE 場面は `freeLayout[].assetId`／通常場面は `assetRefs`＋`character.poseAssetId`）＝休眠側を検査・誤カウント・誤表示しない（P2 解消・`adapters.ts`／`assetUsage.ts`）。**→ 判定式は追補6で更新**（層の実在でも絞る＋FREE でも差し込み先があれば `assetRefs` を数える）。
3. **非破壊往復（Option A・#524 再レビュー・利用者決定 2026-07-14）**：通常配置（`assetRefs`/`slotFits`/`texts`）は切替で清算せず**休眠保持**し、**FREE→通常で自動復元**する（#236 の「切替で清算」を「**FREE 化では清算しない**」へ改める＝ダングリングは `sceneActiveAssetIds` で無害化済み。**→ 追補6で「どちら向きでも清算しない」へ拡張**）。FREE→通常→FREE は休眠 `freeLayout` が戻る。**FREE→通常で動画に出なくなる中身があるときは切替前にインライン確認**（`SceneEditScreen` の見た目ピッカー・黙って消さない＝ADR-0026④）。
   - **確認の条件（#547 P2-9 で改定・2026-07-24）**：当初は「**素材が復元できない**（＝ネイティブ FREE 場面）ときだけ」としていたが、これは
     「**1枚でも復元されれば確認しない**」を意味し、FREE で足した写真・文字が無言で動画から消えていた（通常→FREE→自由配置で追加→通常、が該当）。
     判定を「復元の有無」から「**復元先を超えて出なくなる中身が1つでもあるか**」へ改める＝`freeContentHiddenBySwitch(scene, next)`。
   - **数え方**：要素 id では辿れない（seed は変換のたびに新 id を振り由来を残さない）ため、**中身の同値＋多重度**で突き合わせる。
     通常側で出る中身（差し込み先の素材〔テンプレ既定素材 `layer.assetId` のフォールバック込み〕・立ち絵・text 層が引く `texts`）を多重集合に積み、
     自由配置の各要素を1つずつ消費して**消費できなかった分**を数える。図形は通常テンプレに受け皿が無いので必ず数える。
     **字幕は箱の数で突き合わせない**：通常テンプレの字幕層1枚がその場面の字幕をすべて受け持つ（逐次も同時字幕の段積みも1層＝ADR-0031）ため、
     **その箱が出している文が切替後もすべて出るか**（`sceneDisplayedSubtitleTexts` に含まれるか）で判断する。
     「字幕が1つでも出るか」では足りない＝掛け合い場面で対象＝読み上げ（`texts.subtitle`）の箱は、通常テンプレの字幕層が
     行の字幕で上書きされる（`layoutScene` の `opts.subtitleText`）ため**決して出ない**のに、行字幕があるせいで見逃す。
   - **数えないもの**＝いま出ていない中身：`hidden` の要素・非表示グループのメンバー（ADR-0022）・空スロット/空文字・何も表示していない字幕箱。
     受け皿の数え上げも同じ規則に従う（**非表示グループのメンバー層は受け皿にしない**＝描画されないため）。
   - **境界は描画（`layoutScene`）の条件に合わせる**（数え方が描画とずれた分だけ嘘になる）：文字は**空文字だけ**を除く
     （`text.length > 0` で描く＝空白だけの文字も背景帯つきなら帯が出るので、trim で落とすと帯が黙って消える）。
     立ち絵は **character 層の数だけ**受け皿に積む（層ごとに描かれるため、1つ固定だと2層テンプレで過剰に「出なくなる」と言う）。
   - **確認文言は件数つき**（「素材2個・文字1個が動画に出なくなります」＝15 §5 の件数表示の流儀）。非破壊なので「消える」とは言わず「自由配置に戻せば元どおり」を添える。
     語は「**動画に**出なくなる」で揃える（この製品の「画面」は編集画面を指し紛れるため／同種の確認 `deleteLookConfirmMessage`・`standardLookResultMessage` と同じ語＝§6）。
   - **確認は毎回いまの場面から数え直すが、答えるまで消さない**（PR #592 レビューで改定・2026-07-24）。件数は毎レンダ数え直して**文言に反映**し、
     確認中に中身を消して失う物が無くなったら「動画に出なくなる中身はありません。この見た目に変えますか？」へ切り替える（嘘の警告を出さない・ADR-0026①）。
     一方**確認の表示そのものを件数に連動させない**：連動させると、中身を消した後に足し直した／取り消し（Ctrl+Z）で戻しただけで
     **触ってもいない確認が蘇り**、選択表示が選んでいない見た目へ跳ぶ（#532「選んだのに元へ戻った」と同型）。
     初版（#547 P2-9）は「件数が0になったら確認ごと畳み選択表示も実際の見た目へ戻す＝失効」としていたが、この蘇りを招くため改める。
     畳まないので「確認ボタンが消えて同じ値の選び直しでは変更イベントも出ない＝選んだのに切り替わらない」行き止まりも起きない。
   - **確認を解くのは明示操作だけ**＝「やめる」／別の見た目を選ぶ（何も隠れないなら即適用）／**いまの見た目・いまの種類を選び直す**（＝切替をやめた）／場面を変える。
     **見た目ピッカーと種類セレクタで同じ挙動にする**（片方だけ「選び直しで解ける」だと同じ概念が2つの挙動を持つ＝ADR-0026②）。
   - **確認が残ったまま「いま自由配置ではない」状態は起こりうる**：確認中に「取り消す」を押すと、見た目切替は履歴に載っている（ADR-0020）ので
     場面だけ通常テンプレへ戻り、確認は残る。よって件数を出す前に**必ず実効テンプレでゲートする**（休眠 `freeLayout` を数えない＝決定2）。
     ゲートを外すと「出てもいない中身が動画に出なくなります」という嘘の警告になる（ADR-0026①）。回帰テストで固定済み。
   - **通常→FREE の seed も同じ実表示規則で判定する**：字幕要素を作るかは `sceneDisplayedSubtitleTexts` で見る
     （`texts.subtitle` 固定で見ると、字幕層の `textKey` を変えたマイ見た目〔ADR-0017〕で「元は出ていない字幕」を持ち込み、
     戻すときに「往復しただけなのに字幕が出なくなります」と言う）。
   - 「まとめて標準にする」（`contentHiddenBySwitch` の `freeLayout`）も**同じ関数へ委譲**する＝同じ場面に画面ごとに別の答えを返さない（ADR-0026②）。
4. **FREE スロットの選択肢を一本化**：立ち絵/ロゴを移送しても FREE 編集画面で選び直せるよう、置ける素材種別を `isFreeSlotAssetType`（image/video/yuko/logo/qr/decor）へ集約し、現在値も必ず選択肢へ含める（#524 P1）。
5. **対象外**：装飾レイヤー（`shape`/背景色）は変換しない（意匠）。字幕の背景帯（`layer.background`）は FreeElement に持ち込み先が無く引き継がない＝**#529 で追跡（0.4.2）**。
6. **追補：通常→通常の切替も非破壊にする**（#547 P3-14・2026-07-24）。決定3の非破壊往復は **FREE が絡む向きだけ**に効いていた。通常→通常（「種類」セレクタ＝#528）で切替先に差し込み先が無いと `assetRefs`/`slotFits` は #236 の清算でその場から消え、**元の種類へ戻しても復活しない**（`texts`・`freeLayout` は休眠保持で戻るのに非対称＝ADR-0026②）。実例＝写真紹介（`mainVisual`）→ メッセージ（文字だけ）→ 写真紹介で、写真の割当が失われる。
   - **`switchSceneTemplate` はどちら向きの切替でも `assetRefs`/`slotFits` を清算しない**（`texts` と同じ扱い）。切替先に差し込み先が無いキーは休眠として残り、その差し込み先を持つ見た目へ変えれば再び描かれる。「見た目が見つからない場面をまとめて標準にする」（`applyStandardLookToUnresolvedScenes`）・削除テンプレの標準置換（`substituteDeletedTemplateInScenes`）も同じ正準経路なので同じ扱いになる。
   - **切替先の層一覧を引数から落とす**（`switchSceneTemplate(scene, newTemplateId, newCategory?, prevTemplate?)`）＝受け取っていないものは絞れない＝「実は絞っている」誤解と絞り込みの復活を構造的に防ぐ。
   - **休眠を「使用中」と数えないゲートを通常テンプレ側にも入れる**（決定2の続き）。`sceneActiveAssetIds` は `category` しか見ておらず `assetRefs` を素通しで数えていたため、清算をやめると「動画に出ない写真が使用中」になる。**差し込み先の層が実在するキーだけ**／**立ち絵は character 層があるときだけ**へ絞る＝`layoutScene` が層を辿って描く条件と同じ。台本表の主役素材（`adapters.mainAsset`）も同じ関数を通す＝「動画に出ないのに一覧では写真あり」を作らない（ADR-0026①）。**template 未解決のときは絞らない**（安全側＝使用中を見落として「使っていない素材」に出さない）。
   - **切替の確認は出さない**：`texts`/`freeLayout` の休眠と同じく往復で戻り、しかも消える中身は編集画面の仕上がり確認に即座に現れる＝「黙って壊れる」ではない。FREE→通常の確認（決定3）を残すのは、自由配置は要素数が多く**元の並びが FREE 側にしか無い**ため（戻せても手戻りが大きい）。通常→通常でも確認を出すかは**未解決の論点**へ。
   - **実効使用の判定は「層の実在」で絞るが、カテゴリでは切らない**（決定2の更新）。`layoutScene` は category を見ずに層を辿るため、同梱の自由配置テンプレのように **FREE でも `background` 層があれば `assetRefs.background` は動画に出る**（場面編集の「使用素材」も FREE で出る）。カテゴリでまとめて休眠扱いにすると、出ている背景写真を「どの場面でも使われていません」と言って消させてしまう。よって `sceneActiveAssetIds` は「自由配置要素（FREE のとき）＋差し込み先の層があるキー＋character 層があるときの立ち絵」の**和**で数える。
   - **「使用中か」と「素材として見せるか」は別関数に分ける**：立ち絵（`character.poseAssetId`）は**素材の生存判定には要る**（漏らすと使っているゆうこの表情画像を消させる）が、**素材として見せる用途には入れてはいけない**（`assetType:'yuko'` は video でないので台本表の素材欄に「写真」として並び、写真を入れていない場面が「写真あり」に見える）。よって `sceneActiveAssetIds`（立ち絵込み＝使用中カウント・削除確認・事前確認）と `sceneActivePlacedAssetIds`（差し込み素材のみ＝台本表の主役素材）を分ける。
   - **多めに数える側へ倒すケースが2つあり意図的**：**見た目が見つからない場面**（層が分からない＝全部数える）と**非表示グループのメンバー層**（ADR-0022・`layoutScene` は描かないが数える）。この関数は「使っていない素材」警告と削除確認の根拠でもあり、**数え漏らすと使用中の素材を消させる**（数え過ぎは警告が出ないだけ）。「動画に出なくなる中身」を数える側（`freeContentHiddenBySwitch`）は逆に**出ているものだけ**を見るので非表示グループを除外する＝目的が違うので規則も違う。

## 結果・影響
- `src/domain/project/sceneOps.ts`：`freeLayoutFromPlacedContent`（**実効配置＝`composeGroupGeometry`/`isHiddenByGroup`**・slot/character/text/subtitle＋`slotClips` 移送マップ `{elements, slotClips}` を返す）＋`switchSceneTemplate` に `prevTemplate?` 引数・seed・`slotClips` マージ。
- **文字/字幕の「表示中の内容」には体裁と行数も含む**（#555 レビュー）：
  - 体裁は `resolveTextStyle(layer, scene.textStyles?.[textKey])` の**実効値**を写す（生の `layer.*` を写すと、場面で変えた色/大きさが FREE 化で黙ってテンプレ既定へ戻る＝隣の `fontId` は per-scene で移送しているのに体裁だけ戻る非対称・ADR-0026②）。
  - **枠高は「同じ行数が入る高さ」へ広げる**（`boxHeightForLines`）。通常は `maxLines`（既定2）で行数が決まるのに対し **FREE は枠高から行数を導出する**（`linesForBoxHeight`）ため、枠高をそのまま持ち込むと行が減って文字が切り詰められる（`wrapText` が末尾を … にする）。実例＝標準テンプレの見出し層（h=140・72px）は通常2行だが、そのままでは FREE で1行。**縮めはしない**＝枠高は回転の中心（`y + h/2`）にも効くため、利用者テンプレ（ADR-0017）が文字層を回転させていた場合に位置が動くのを避ける。
  - **字幕の枠は上端 y を「帯が実際に占めていた上端」へ移す**（`subtitleTopY`）。テンプレ字幕層は**下端基準**
    （`anchorBottom`＝行が増えると上へ伸び下端が動かない・ADR-0031）だが、**FREE 字幕は上端起点で下へ伸びる**
    （箱は利用者のもの＝ADR-0008）＝同じ y に置くと帯が `(行数-1)×行高` ぶん下がり、画面下端からはみ出しうる
    （字幕60px・2行で下端 1034→1112＝キャンバス外）。1行字幕は元から一致するので動かさない。掛け合いは行ごとに
    行数が変わり単一の y では一致させられないため、**全行の最大行数**に寄せる＝どの行でもテンプレより下がらない側を採る。
  - ＝本 ADR の「表示中の内容を持ち込む」は**幾何の逐語コピーではなく、見える結果の保存**と読む（両立しないときは内容を優先）。
- `src/domain/enums.ts`：`FREE_SLOT_ASSET_TYPES`／`isFreeSlotAssetType`（FREE スロットに置ける素材種別＝映像として描ける非音声）を新設。`SceneEditScreen` の FREE 素材候補と現在値保持を一本化。
- `src/domain/project/assetUsage.ts`：`sceneActiveAssetIds`（実効テンプレでゲート）を新設し `sceneUsesAsset`/`scenesUsingAsset` を template 受け取りへ。`adapters.ts`（precheck）と `MaterialsScreen.tsx`（逆引き/削除確認）が同一規則を共有。
- `src/domain/template/layerOrder.ts`：`DEFAULT_LAYER_Z`／`effectiveLayerZ`（レイヤーの実効 z＝05§7）を新設。通常描画（`layout.ts`）と 通常→FREE 変換が同じ実効 z を参照＝`zIndex` 未指定でも重なり順一致（#524 P2）。
- `src/app/screens/SceneEditScreen.tsx`：ピッカー onChange で旧テンプレ（`s.templateId` 解決）を `switchSceneTemplate` へ渡す。**FREE→通常で動画に出なくなる中身があるときはインライン確認**（`pendingTemplateId`・件数は毎レンダで数え直して文言へ反映し、確認自体は答えるまで残す）。
- `src/domain/project/sceneOps.ts`：`freeContentHiddenBySwitch`（#547 P2-9・上記 決定3）。`src/domain/project/subtitleBinding.ts`：`freeSubtitleElementTexts`（字幕箱の実表示を `sceneDisplayedSubtitleTexts` と共有）。
- **正典**：`11_SCHEMA_REFERENCE.md` に「`freeLayout` は任意 `sceneType` に存在しうる（**有効なのは FREE テンプレのときだけ＝それ以外は休眠**）」を明記。#236 の非対称（`texts` は保持）を `freeLayout`/`assetRefs` にも広げる読み。**schema 据え置き**（`freeLayout` は enum 条件を課さない任意フィールド＝`project.schema` の版は変えない）。
  - **追補6（#547 P3-14）で 11 §5 の不変条件も読み替える**：「`assetRefs` のキー集合 ⊆ テンプレのスロット id 集合」は**保存データの制約ではなく、描画・実効使用の条件**（差し込み先の層があるキーだけが描かれ・数えられる）。保存データは休眠キーを持ちうる。**schema 据え置き**（`AssetRefs` は `patternProperties` で任意キーを許すため適合）。
- テスト：通常→FREE の素材/収め方/回転/`slotClips`/立ち絵/字幕（単独=narration・掛け合い=allLines）変換・**グループ実効配置**・**zIndex 未指定の実効 z**、**非破壊往復（通常→FREE→通常で assetRefs/slotFits 復元）**、休眠 `freeLayout`・assetRefs・character が precheck/逆引きに出ないこと。

## 未解決の論点
- **休眠参照は素材の削除で黙って壊れる**（追補6 レビューで顕在化・**要対応**）。休眠は「使用中」に数えないので、休眠中の素材は削除確認で「どの場面でも使われていません」と出て消せる（`removeAsset` は場面側の参照を掃除しない）＝あとで元の見た目へ戻すと**空スロット**になり、切替は `warnings: []` で再検証もしないため無警告（§2-5／ADR-0026④）。ADR-0030 決定2（FREE の休眠 `assetRefs`）以来ある穴だが、追補6 で通常→通常にも広がり到達しやすくなった。案＝**破壊的操作（削除確認）だけは休眠込みの参照で数えて件数・文言を出す**（「使っていない素材」警告は実効使用のまま＝目的が違う）か、`removeAsset` で全場面の参照を落として「消えたこと」を明示する。**別 Issue で追跡**。
- **通常→通常の切替でも「動画に出なくなる中身」の確認を出すか**（追補6・**ユーザー確認**）。いまは出さない（往復で戻る＋編集画面で即見える）が、FREE→通常は出すので**同じ概念で挙動が2つ**とも読める（ADR-0026②）。出す場合の判定は `contentHiddenBySwitch(scene, next, prev)`（`slotIds`/`textKeys`/`character` を既に返す）に寄せ、確認バナーと文言を FREE 側（`freeSwitchConfirmMessage`）と共有する。
- 字幕の背景帯（`layer.background`）の FREE への持ち込み＝**#529 で追跡（0.4.2・`FreeElement` に背景帯追加・#264 と統合検討）**。
- 通常配置と自由配置の二重表現（切替で各面が自分の並びを保ち相互にマージしない）は仕様として許容（往復でデータは消えない）。FREE 編集後に通常へ戻すと通常は元の並び（FREE 編集は FREE 側に残る）。
