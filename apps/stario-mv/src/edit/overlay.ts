// プレビューで掴む（MV-0008 決定6）。画面に依存しない純粋な関数。
// ⚠️ 枠そのものは Rust が描画の核で求める（`preview_bounds`＝窓の画素）。ここは**欄の座標へ写す・当たりを見る・動かす量を組み立てる**だけ。
import { setValueOp } from "./props";
import type { AnimValue, Layer, UpdateOp } from "./types";

export type Point = [number, number];

/** Rust の答え（`preview::bounds_json`）。corners は窓の画素（物理）。 */
export interface Bounds {
  frame: number;
  /** コンポジションの 1 画素が、窓の何画素（物理）か。 */
  scale: number;
  /** 先頭が最前面。 */
  layers: { layerId: string; corners: [Point, Point, Point, Point] }[];
}

/** 窓の画素（物理）→ 欄の中の CSS 画素。 */
export function toPanel(p: Point, panelLeft: number, panelTop: number, dpr: number): Point {
  return [p[0] / dpr - panelLeft, p[1] / dpr - panelTop];
}

/** 点が四角（凸の四隅・どちら回りでも）の中か。辺の上も中とする。 */
export function insideQuad(q: readonly Point[], p: Point): boolean {
  let sign = 0;
  for (let i = 0; i < q.length; i += 1) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % q.length];
    const cross = (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * その場所にある**いちばん手前のレイヤー**（MV-0008 決定6）。`p` は欄の CSS 画素。錠のかかったものは選ばない（AE の型）。
 */
export function pickLayerAt(
  b: Bounds,
  p: Point,
  panelLeft: number,
  panelTop: number,
  dpr: number,
  locked: ReadonlySet<string>,
): string | null {
  for (const l of b.layers) {
    if (locked.has(l.layerId)) continue;
    const q = l.corners.map((c) => toPanel(c, panelLeft, panelTop, dpr));
    if (insideQuad(q, p)) return l.layerId;
  }
  return null;
}

/** 掴んで動かした量（欄の CSS 画素）→ コンポジションの画素。`Shift`＝縦か横の大きいほうだけ。 */
export function dragDelta(dxCss: number, dyCss: number, dpr: number, scale: number, axisLock: boolean): Point {
  const k = scale > 0 ? dpr / scale : 0;
  let [dx, dy] = [dxCss * k, dyCss * k];
  if (axisLock) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  return [dx, dy];
}

/**
 * 位置を動かす取引。キーフレームになっていれば今の時刻のキーを打つ（値の欄と同じ＝MV-0008 決定5・6）。
 * `start`＝掴んだときの位置（Rust が求めた今の時刻の値）。
 */
export function movePositionOp(l: Layer, frame: number, start: AnimValue, delta: Point): UpdateOp {
  const s = Array.isArray(start) ? start : [start, 0];
  const next = [s[0] + delta[0], s[1] + delta[1], ...s.slice(2)];
  return setValueOp(l, "/transform/position", frame, next);
}
