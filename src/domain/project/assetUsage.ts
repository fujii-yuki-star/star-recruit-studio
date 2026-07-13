// 素材がどの場面で使われているかの検出（純粋ロジック・§7）。削除前の確認（使用場面数）や
// 逆引き導線（#406）で共有する。判定は adapters.buildPrecheckItems の「used」集合と同一規則：
// assetRefs（スロット割当）・character.poseAssetId（ゆうこのポーズ）・freeLayout[].assetId（FREE 要素・ADR-0008）。
import type { Scene } from './types';

/** 1場面がこの素材を使っているか（assetRefs / character.poseAssetId / freeLayout[].assetId のいずれか）。 */
export function sceneUsesAsset(scene: Scene, assetId: string): boolean {
  if (Object.values(scene.assetRefs).some((v) => v === assetId)) return true;
  if (scene.character?.poseAssetId === assetId) return true;
  if ((scene.freeLayout ?? []).some((el) => el.assetId === assetId)) return true;
  return false;
}

/** この素材を使っている場面の配列（順序は scenes のまま）。件数や一覧（逆引き・#406）に使う。 */
export function scenesUsingAsset(scenes: Scene[], assetId: string): Scene[] {
  return scenes.filter((s) => sceneUsesAsset(s, assetId));
}
