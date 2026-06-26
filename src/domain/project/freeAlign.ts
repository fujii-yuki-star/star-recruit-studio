// FREE 自由配置：複数選択した要素の「整列」「等間隔分布」を計算する純粋ロジック（#205）。
// 返り値は applyFreeElementPositions / moveFreeMany にそのまま渡せる移動量 {id,x,y}[]（座標は整数化）。
// 基準は「選択要素の外接矩形」（デザインツール標準）。キャンバス端そろえとは別物。
import type { FreeElement } from './types';

/** 整列の種類。左/右/上/下の各辺そろえと、左右中央(=中心X一致)・上下中央(=中心Y一致)。 */
export const FREE_ALIGN = {
  left: 'left',
  centerX: 'centerX',
  right: 'right',
  top: 'top',
  centerY: 'centerY',
  bottom: 'bottom',
} as const;
export type FreeAlign = (typeof FREE_ALIGN)[keyof typeof FREE_ALIGN];

/** 等間隔分布の軸（横＝中心Xを等間隔／縦＝中心Yを等間隔）。 */
export const FREE_DISTRIBUTE = {
  horizontal: 'horizontal',
  vertical: 'vertical',
} as const;
export type FreeDistribute = (typeof FREE_DISTRIBUTE)[keyof typeof FREE_DISTRIBUTE];

interface PositionMove {
  id: string;
  x: number;
  y: number;
}

/**
 * 選択した要素を整列した移動量を返す（2件未満は空＝整列対象なし）。
 * 基準は選択全体の外接矩形（left/right/top/bottom と中心）。x,y は整数に丸める。
 */
export function alignFreeElements(
  freeLayout: FreeElement[], ids: string[], mode: FreeAlign,
): PositionMove[] {
  const els = freeLayout.filter((e) => ids.includes(e.id));
  if (els.length < 2) return [];
  const left = Math.min(...els.map((e) => e.x));
  const right = Math.max(...els.map((e) => e.x + e.w));
  const top = Math.min(...els.map((e) => e.y));
  const bottom = Math.max(...els.map((e) => e.y + e.h));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  return els.map((e) => {
    let { x, y } = e;
    switch (mode) {
      case FREE_ALIGN.left: x = left; break;
      case FREE_ALIGN.right: x = right - e.w; break;
      case FREE_ALIGN.centerX: x = centerX - e.w / 2; break;
      case FREE_ALIGN.top: y = top; break;
      case FREE_ALIGN.bottom: y = bottom - e.h; break;
      case FREE_ALIGN.centerY: y = centerY - e.h / 2; break;
    }
    return { id: e.id, x: Math.round(x), y: Math.round(y) };
  });
}

/**
 * 選択した要素を等間隔に分布した移動量を返す（3件未満は空＝分布の意味なし）。
 * 両端（中心が最小/最大の要素）は固定し、中間要素の中心を等間隔に並べる。x,y は整数に丸める。
 */
export function distributeFreeElements(
  freeLayout: FreeElement[], ids: string[], axis: FreeDistribute,
): PositionMove[] {
  const els = freeLayout.filter((e) => ids.includes(e.id));
  if (els.length < 3) return [];
  const horizontal = axis === FREE_DISTRIBUTE.horizontal;
  const centerOf = (e: FreeElement) => (horizontal ? e.x + e.w / 2 : e.y + e.h / 2);
  const sorted = [...els].sort((a, b) => centerOf(a) - centerOf(b));
  const first = centerOf(sorted[0]);
  const last = centerOf(sorted[sorted.length - 1]);
  const step = (last - first) / (sorted.length - 1);
  return sorted.map((e, i) => {
    const center = first + step * i;
    return horizontal
      ? { id: e.id, x: Math.round(center - e.w / 2), y: e.y }
      : { id: e.id, x: e.x, y: Math.round(center - e.h / 2) };
  });
}
