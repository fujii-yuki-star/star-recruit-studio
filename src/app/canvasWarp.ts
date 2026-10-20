// キャンバスに重ねる印を、部品の**ゆがみ**（反転・縦横の倍率・ADR-0059）に合わせて映す（#1416）。計算だけ（画面は当てるだけ）。
import type { Affine } from "../renderer/layout";

/**
 * 箱（キャンバスの座標）に置いた印の `transform`（`transform-origin` は既定の中心）。
 *
 * 描画は「箱を中心まわりに回す → 部品のゆがみの行列を当てる」。印も同じ順に映す＝
 * `translate(ゆがみで中心が動いた量) matrix(ゆがみの線形部分) rotate(回転)`（右から当たる）。
 * ⚠️ 動いた量は**印自身の大きさに対する割合**で書く＝キャンバスを縮めて見せても一緒に縮む（印の位置も割合で置いている）。
 * ゆがみも回転も無ければ `undefined`（今までの印と同じ）。
 */
export function overlayWarpTransform(r: { x: number; y: number; w: number; h: number; rotation?: number; warp?: Affine }): string | undefined {
  const rot = r.rotation ?? 0;
  const rotate = rot ? `rotate(${rot}deg)` : "";
  if (!r.warp) return rotate || undefined;
  const [a, b, c, d, e, f] = r.warp;
  const qx = r.x + r.w / 2;
  const qy = r.y + r.h / 2;
  const dx = a * qx + c * qy + e - qx;
  const dy = b * qx + d * qy + f - qy;
  const pct = (v: number, size: number): number => (size > 0 ? (v / size) * 100 : 0);
  return [`translate(${pct(dx, r.w)}%, ${pct(dy, r.h)}%)`, `matrix(${a}, ${b}, ${c}, ${d}, 0, 0)`, rotate].filter(Boolean).join(" ");
}

/**
 * 文字を直している間の欄の置き方（`FreeLayoutOverlay` の `textEditScaleOf`・#1475）。
 *
 * 枠は**倍率まで当てた長方形**（`shownBox`）なので、直す欄は**倍率を当てる前の大きさ**（枠の `1/|倍率|`）で中央に置き、
 * `scale(倍率)` で枠いっぱいへ伸ばす・裏返す＝描画と同じ「折り返してから伸ばす」。倍率が無ければ `undefined`（今までと同じ）。
 */
export function editScaleStyle(s: { x: number; y: number } | undefined): { width: string; height: string; left: string; top: string; transform: string } | undefined {
  if (!s || (s.x === 1 && s.y === 1)) return undefined;
  const w = 100 / Math.abs(s.x);
  const h = 100 / Math.abs(s.y);
  return { width: `${w}%`, height: `${h}%`, left: `${(100 - w) / 2}%`, top: `${(100 - h) / 2}%`, transform: `scale(${s.x}, ${s.y})` };
}
