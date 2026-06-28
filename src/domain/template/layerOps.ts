// テンプレ作成エディタのレイヤー操作（ADR-0017・#214 ③b）。Layer[] の追加/削除/更新の純粋関数（§7 テスト対象）。
import { LAYER_TYPES, type LayerType } from '../enums';
import type { Layer } from './types';

/** エディタで追加できるレイヤー型（ADR-0017：decor は開放しない＝静的装飾は slot/shape で代替）。 */
export const TEMPLATE_ADDABLE_LAYER_TYPES: LayerType[] = LAYER_TYPES.filter((t) => t !== 'decor');

const LAYER_DEFAULT_W = 480;
const LAYER_DEFAULT_H = 240;

/** 既存と衝突しない layer id（layer_NNN・テンプレ内一意・空き番号を埋める）。 */
export function createLayerId(layers: Layer[]): string {
  const used = new Set(layers.map((l) => l.id));
  let n = 1;
  while (used.has(`layer_${String(n).padStart(3, '0')}`)) n += 1;
  return `layer_${String(n).padStart(3, '0')}`;
}

/** 指定 type のレイヤーを既定値で追加する（最前面）。background は全面、それ以外はキャンバス中央あたり。 */
export function addLayer(layers: Layer[], type: LayerType, canvas: { width: number; height: number }): Layer[] {
  const id = createLayerId(layers);
  const zIndex = layers.reduce((m, l) => Math.max(m, l.zIndex ?? 0), 0) + 1;
  const layer: Layer =
    type === 'background'
      ? { id, type, x: 0, y: 0, w: canvas.width, h: canvas.height, zIndex }
      : {
          id,
          type,
          zIndex,
          x: Math.round(canvas.width / 2 - LAYER_DEFAULT_W / 2),
          y: Math.round(canvas.height / 2 - LAYER_DEFAULT_H / 2),
          w: Math.min(LAYER_DEFAULT_W, canvas.width),
          h: Math.min(LAYER_DEFAULT_H, canvas.height),
        };
  return [...layers, layer];
}

/** 指定 id のレイヤーを取り除く。 */
export function removeLayer(layers: Layer[], id: string): Layer[] {
  return layers.filter((l) => l.id !== id);
}

/** 指定 id のレイヤーを部分更新する（id/type は変えない）。 */
export function updateLayer(layers: Layer[], id: string, patch: Partial<Omit<Layer, 'id' | 'type'>>): Layer[] {
  return layers.map((l) => (l.id === id ? { ...l, ...patch } : l));
}
