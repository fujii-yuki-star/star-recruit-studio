// テンプレ レイヤーの標準描画順（05 §7）の単一の参照元。
// 通常描画（renderer/layout）と 通常→FREE 変換（domain/project/sceneOps）が同じ実効 z を参照し、
// zIndex 未指定テンプレでも重なり順が一致する（ADR-0030・#524 P2・パリティ）。§2-7。
import type { LayerType } from '../enums';
import type { Layer } from './types';
import { moveByZ } from '../zOrder';

/** 種別ごとの標準描画順（05 §7）。数が大きいほど前面。テンプレに zIndex があればそれを優先。 */
export const DEFAULT_LAYER_Z: Record<LayerType, number> = {
  background: 0, slot: 10, shape: 20, decor: 20, text: 30, character: 40, subtitle: 50, logo: 60,
};

/** レイヤーの実効 z-index（明示 `zIndex` 優先・無ければ種別ごとの既定順）。 */
export function effectiveLayerZ(layer: Layer): number {
  return layer.zIndex ?? DEFAULT_LAYER_Z[layer.type];
}

/**
 * レイヤーの重ね順を1段だけ前面/背面へ（テンプレ作成の一覧の↑↓・#547 P2-4）。
 * 並べ替えの基準は**実効 z**＝`effectiveLayerZ`（描画・一覧の並びと同じ）。zIndex 未指定のレイヤーでも
 * 「見えている順」どおりに1段動く（`zIndex ?? 0` で並べると描画と食い違う）。
 */
export function moveLayerZ(layers: Layer[], id: string, direction: 'up' | 'down'): Layer[] {
  return moveByZ(layers, id, direction, effectiveLayerZ);
}
