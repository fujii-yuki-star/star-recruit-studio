// 素材がどの場面で使われているかの検出（純粋ロジック・§7）。削除前の確認（使用場面数）・逆引き導線（#406）・
// 事前確認（adapters.buildPrecheckItems の「used」集合）・台本表の主役素材（adapters.mainAsset）で**同一規則**を共有する。
// 実効表現だけを「使用中」と数える（ADR-0030）＝**その見た目が実際に描く分だけ**：自由配置要素は FREE テンプレのとき、
// assetRefs は差し込み先の層があるキー、立ち絵は character 層があるとき。休眠側（通常場面に残った freeLayout／
// 差し込み先を失った assetRefs）は描画されないので数えない＝切替後の誤カウント/誤表示を防ぐ。
import { FREE_CATEGORY, LAYER_TYPE } from '../enums';
import { templateSlotIds } from '../template/layerOps';
import type { Template } from '../template/types';
import type { Scene } from './types';

/**
 * 場面が「実効的に」使う素材 id（実効テンプレの表現だけ＝休眠は除外・ADR-0030）。
 *
 * **その見た目が実際に描く分だけ**を数える＝`assetRefs` は差し込み先の層（`templateSlotIds`）が実在するキー、
 * 立ち絵は character 層があるとき、自由配置要素は FREE テンプレのとき。切替で差し込み先を失った割当は
 * **休眠として残る**（清算しない＝`switchSceneTemplate`・#547 P3-14）ので、ここで絞らないと
 * 「動画に出ていない写真が使用中」と数えてしまう。
 *
 * **絞りきらない（＝多めに数える）ケースが2つあり、いずれも意図的**：
 * - **template 未解決**（見た目が見つからない場面）は層が分からないので全部数える。
 * - **非表示グループのメンバー層**（ADR-0022）は `layoutScene` は描かないがここでは数える。
 * どちらも**素材を消させない側**へ倒すため＝この関数は「使っていない素材」警告と削除確認の根拠でもあり、
 * 数え漏らすと利用者が使用中の素材を消してしまう（数え過ぎは警告が出ないだけで壊れない）。
 * 「動画に出なくなる中身」を数える側（`freeContentHiddenBySwitch`）は逆に**出ているものだけ**を見るので
 * 非表示グループを除外する＝目的が違うので規則も違う。
 */
export function sceneActiveAssetIds(scene: Scene, template: Template | undefined): string[] {
  const ids = sceneActivePlacedAssetIds(scene, template);
  const hasCharacterLayer = template ? template.layers.some((l) => l.type === LAYER_TYPE.character) : true;
  if (scene.character?.poseAssetId && hasCharacterLayer) ids.push(scene.character.poseAssetId);
  return ids;
}

/**
 * 場面が実効的に使う**差し込み素材**の id（`assetRefs`＋自由配置の要素）。**立ち絵（ゆうこ）は含めない**。
 *
 * 「この場面の写真・動画」を見せる用途（台本表の素材欄）で使う。立ち絵は素材ではなく登場人物で、
 * 混ぜると `assetType:'yuko'` が「写真」として素材欄に並ぶ（写真を入れていない場面が「写真あり」に見える・
 * #547 P3-14 レビュー）。**素材の生存判定（使用中カウント・削除確認）には使わないこと**＝立ち絵が漏れて
 * 使用中の素材を消させる。そちらは `sceneActiveAssetIds`。
 */
export function sceneActivePlacedAssetIds(scene: Scene, template: Template | undefined): string[] {
  const ids: string[] = [];
  // 自由配置の要素は FREE テンプレのときだけ描かれる（それ以外では休眠＝ADR-0030 決定2）。
  if (template?.category === FREE_CATEGORY) {
    for (const el of scene.freeLayout ?? []) if (el.assetId) ids.push(el.assetId);
  }
  // 差し込み先は**カテゴリで切らない**：`layoutScene` は category を見ずに層を辿るので、同梱の自由配置テンプレのように
  // FREE でも `background` 層を持てば `assetRefs.background` は動画に出る（場面編集の「使用素材」も FREE で出る）。
  // category で切ると、出ている背景写真を「どの場面でも使われていません」と言って消させてしまう（#547 P3-14 レビュー）。
  const slotIds = template ? templateSlotIds(template.layers) : null;
  for (const [layerId, v] of Object.entries(scene.assetRefs)) if (v && (!slotIds || slotIds.has(layerId))) ids.push(v);
  return ids;
}

/** 1場面がこの素材を実効的に使っているか（実効テンプレの表現だけ・ADR-0030）。 */
export function sceneUsesAsset(scene: Scene, assetId: string, template: Template | undefined): boolean {
  return sceneActiveAssetIds(scene, template).includes(assetId);
}

/**
 * その素材を**どこかが指しているか**（#348・削除の安全判定）。
 *
 * ⚠️ **`sceneActiveAssetIds`（描画されるもの）とは別の規則**。理由＝**目的が違う**。
 * - 公開前チェックの「使っていない素材」は**動画に出るか**を言う警告＝多少ずれても「そのままでよい」で済む。
 * - こちらは**消してよいか**＝間違えると**取り消せない**（`assets` は履歴の外＝ADR-0020/0028）。
 *
 * だから**ゲートを一切かけない**（休眠も数える）：
 * - 差し込み先の層を失った `assetRefs` のキー（通常→通常の切替で休眠・ADR-0030 追補6）
 * - 通常テンプレ場面に残った `freeLayout`（FREE へ戻すと**再び描かれる**＝`11 §5` の約束）
 * - character 層の無いテンプレでの `poseAssetId`
 * - 見た目パターンが**解決できない**場面（別PCへ持ち込み・テンプレ削除・起動直後）
 * - **BGM**（`bgmSettings.assetId`＝プロジェクト既定と場面ごとの両方）
 *
 * ⚠️ **BGM を入れる理由**＝場面だけを見ると、自分で取り込んだ BGM が「どこからも指されていない」に
 * 落ちる。焼き出し（`bake.ts`）が同じ経路を数えているのが先例。
 */
export function referencedAssetIds(
  scenes: readonly Scene[],
  projectBgmAssetId?: string | null,
): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | null | undefined): void => { if (id) ids.add(id); };
  add(projectBgmAssetId);
  for (const s of scenes) {
    for (const v of Object.values(s.assetRefs ?? {})) add(v);
    for (const el of s.freeLayout ?? []) add(el.assetId);
    add(s.character?.poseAssetId);
    add(s.bgmSettings?.assetId);
  }
  return ids;
}

/**
 * **どこからも指されていない**素材（#348）。まとめて消す対象はこれ。
 *
 * ⚠️ **「動画に出ていない」ではない**＝見た目を戻せば出てくるもの（休眠）は**消させない**。
 * 公開前チェックの「使っていない素材」より**少なく**出るのは意図どおりで、
 * **消す判断は安全側へ倒す**（数え過ぎると使っている素材を消させる＝取り消せない）。
 */
export function unusedAssetIds(
  assets: readonly { assetId: string }[],
  scenes: readonly Scene[],
  projectBgmAssetId?: string | null,
): string[] {
  const referenced = referencedAssetIds(scenes, projectBgmAssetId);
  return assets.filter((a) => !referenced.has(a.assetId)).map((a) => a.assetId);
}

/** この素材を実効的に使っている場面の配列（順序は scenes のまま）。件数や一覧（逆引き・#406）に使う。 */
export function scenesUsingAsset(
  scenes: Scene[],
  assetId: string,
  templateOf: (scene: Scene) => Template | undefined,
): Scene[] {
  return scenes.filter((s) => sceneUsesAsset(s, assetId, templateOf(s)));
}
