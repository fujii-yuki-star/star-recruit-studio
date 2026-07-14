// テンプレ レイヤーの標準描画順（05 §7）の単一の参照元。
// 通常描画（renderer/layout）と 通常→FREE 変換（domain/project/sceneOps）が同じ実効 z を参照し、
// zIndex 未指定テンプレでも重なり順が一致する（ADR-0030・#524 P2・パリティ）。§2-7。
import type { LayerType } from '../enums';
import type { Layer } from './types';

/** 種別ごとの標準描画順（05 §7）。数が大きいほど前面。テンプレに zIndex があればそれを優先。 */
export const DEFAULT_LAYER_Z: Record<LayerType, number> = {
  background: 0, slot: 10, shape: 20, decor: 20, text: 30, character: 40, subtitle: 50, logo: 60,
};

/** レイヤーの実効 z-index（明示 `zIndex` 優先・無ければ種別ごとの既定順）。 */
export function effectiveLayerZ(layer: Layer): number {
  return layer.zIndex ?? DEFAULT_LAYER_Z[layer.type];
}
