// 素材がどの場面で使われているかの検出（純粋ロジック・§7）。削除前の確認（使用場面数）・逆引き導線（#406）・
// 事前確認（adapters.buildPrecheckItems の「used」集合）で**同一規則**を共有する。
// 実効表現だけを「使用中」と数える（ADR-0030）：FREE 場面＝freeLayout[].assetId、通常場面＝assetRefs＋character.poseAssetId。
// 休眠側（通常場面に残った freeLayout／FREE 場面の assetRefs・character）は描画されないので数えない＝切替後の誤カウント/誤表示を防ぐ。
import { FREE_CATEGORY } from '../enums';
import type { Template } from '../template/types';
import type { Scene } from './types';

/** 場面が「実効的に」使う素材 id（実効テンプレの表現だけ＝休眠は除外・ADR-0030）。template 未解決は通常扱い。 */
export function sceneActiveAssetIds(scene: Scene, template: Template | undefined): string[] {
  const ids: string[] = [];
  if (template?.category === FREE_CATEGORY) {
    for (const el of scene.freeLayout ?? []) if (el.assetId) ids.push(el.assetId);
  } else {
    for (const v of Object.values(scene.assetRefs)) if (v) ids.push(v);
    if (scene.character?.poseAssetId) ids.push(scene.character.poseAssetId);
  }
  return ids;
}

/** 1場面がこの素材を実効的に使っているか（実効テンプレの表現だけ・ADR-0030）。 */
export function sceneUsesAsset(scene: Scene, assetId: string, template: Template | undefined): boolean {
  return sceneActiveAssetIds(scene, template).includes(assetId);
}

/** この素材を実効的に使っている場面の配列（順序は scenes のまま）。件数や一覧（逆引き・#406）に使う。 */
export function scenesUsingAsset(
  scenes: Scene[],
  assetId: string,
  templateOf: (scene: Scene) => Template | undefined,
): Scene[] {
  return scenes.filter((s) => sceneUsesAsset(s, assetId, templateOf(s)));
}
