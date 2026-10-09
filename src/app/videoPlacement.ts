// 実映像（`<video>`）の置き方（ADR-0059）。部品のファイルから関数を出さない（`react-refresh/only-export-components`）。
/**
 * ゆがみを掛けた要素の置き方（ADR-0059）。純粋関数。ゆがみが無ければ今までどおり（回転だけ）。
 * - 中心 → 行列で移した点（要素の左上は、移した中心から半分戻した所）。
 * - 変形 → `matrix(A·R)`（A＝ゆがみの 2×2・R＝要素の回転）。CSS の基準点は要素の中心（既定）。
 */
export function warpedPlacement(
  rect: { x: number; y: number; w: number; h: number },
  rotationDeg: number,
  matrix: readonly [number, number, number, number, number, number] | undefined,
): { x: number; y: number; transform?: string } {
  if (!matrix) return { x: rect.x, y: rect.y, ...(rotationDeg ? { transform: `rotate(${rotationDeg}deg)` } : {}) };
  const [a, b, c, d, e, f] = matrix;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const nx = a * cx + c * cy + e;
  const ny = b * cx + d * cy + f;
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // A·R＝[a c; b d]·[cos −sin; sin cos]。CSS の matrix(p11, p21, p12, p22, 0, 0)。
  const p11 = a * cos + c * sin;
  const p12 = -a * sin + c * cos;
  const p21 = b * cos + d * sin;
  const p22 = -b * sin + d * cos;
  return { x: nx - rect.w / 2, y: ny - rect.h / 2, transform: `matrix(${p11}, ${p21}, ${p12}, ${p22}, 0, 0)` };
}
