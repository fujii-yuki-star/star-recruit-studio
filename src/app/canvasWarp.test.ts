// キャンバスの印を部品のゆがみに合わせる（#1416）。
import { describe, expect, it } from "vitest";
import { editScaleStyle, overlayWarpTransform } from "./canvasWarp";

/** CSS の `translate(%) matrix() rotate()` を、印の4隅に当てた結果（キャンバスの座標）。検査の側で式を組み直す。 */
function corners(r: { x: number; y: number; w: number; h: number; rotation?: number; warp?: readonly number[] }): number[][] {
  const t = overlayWarpTransform(r as Parameters<typeof overlayWarpTransform>[0]) ?? "";
  const tr = /translate\(([-\d.e]+)%, ([-\d.e]+)%\)/.exec(t);
  const mx = /matrix\(([^)]*)\)/.exec(t);
  const ro = /rotate\(([-\d.e]+)deg\)/.exec(t);
  const [a, b, c, d] = mx ? mx[1].split(",").map(Number) : [1, 0, 0, 1];
  const tx = tr ? (Number(tr[1]) / 100) * r.w : 0;
  const ty = tr ? (Number(tr[2]) / 100) * r.h : 0;
  const rad = ((ro ? Number(ro[1]) : 0) * Math.PI) / 180;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([px, py]) => {
    const vx = px - cx;
    const vy = py - cy;
    const rx = vx * Math.cos(rad) - vy * Math.sin(rad);
    const ry = vx * Math.sin(rad) + vy * Math.cos(rad);
    return [Math.round((cx + a * rx + c * ry + tx) * 1e6) / 1e6, Math.round((cy + b * rx + d * ry + ty) * 1e6) / 1e6];
  });
}

describe("overlayWarpTransform（#1416）", () => {
  it("ゆがみも回転も無ければ何も付けない・回転だけなら今までと同じ", () => {
    expect(overlayWarpTransform({ x: 0, y: 0, w: 10, h: 10 })).toBeUndefined();
    expect(overlayWarpTransform({ x: 0, y: 0, w: 10, h: 10, rotation: 30 })).toBe("rotate(30deg)");
  });

  it("左右反転した部品（箱の中心 x=200）の中の層は、鏡に映した位置に出る", () => {
    // 層 (100,50,40,20)。反転の行列は x' = −x + 400。映した層は (260,50)〜(300,70)。
    const out = corners({ x: 100, y: 50, w: 40, h: 20, warp: [-1, 0, 0, 1, 400, 0] });
    const xs = out.map((p) => p[0]).sort((m, n) => m - n);
    const ys = out.map((p) => p[1]).sort((m, n) => m - n);
    expect([xs[0], xs[3], ys[0], ys[3]]).toEqual([260, 300, 50, 70]);
  });

  it("描画と同じ順（回してからゆがめる）＝回した層の隅が、行列を当てた隅と一致する", () => {
    const r = { x: 10, y: 20, w: 40, h: 20, rotation: 90 };
    const warp = [0.5, 0, 0, 1, 30, 0] as const; // 横だけ半分（中心 x=60 まわり）
    const before = corners(r);
    const expected = before.map(([x, y]) => [Math.round((0.5 * x + 30) * 1e6) / 1e6, y]);
    expect(corners({ ...r, warp })).toEqual(expected);
    // CSS は右から当たる＝回転が最後（いちばん右）でないと、描画と逆の順になる（上の隅の検査は順を組み直すので、順はここで見る）。
    expect(overlayWarpTransform({ ...r, warp })).toMatch(/^translate\(.*\) matrix\(.*\) rotate\(90deg\)$/);
  });
});

describe("editScaleStyle（#1475）", () => {
  it("倍率が無ければ何も付けない（今までと同じ）", () => {
    expect(editScaleStyle(undefined)).toBeUndefined();
    expect(editScaleStyle({ x: 1, y: 1 })).toBeUndefined();
  });
  it("反転だけ＝同じ大きさで裏返す", () => {
    expect(editScaleStyle({ x: -1, y: 1 })).toEqual({ width: "100%", height: "100%", left: "0%", top: "0%", transform: "scale(-1, 1)" });
  });
  // ⚠️ **伸ばす前の大きさで折り返す**（PR レビュー 🟡）＝枠（伸ばした後）いっぱいの欄で打つと、改行の位置が描画と変わる。
  it("横 2 倍＝欄は枠の半分の幅で中央に置き、2 倍に伸ばす", () => {
    expect(editScaleStyle({ x: 2, y: 1 })).toEqual({ width: "50%", height: "100%", left: "25%", top: "0%", transform: "scale(2, 1)" });
  });
  it("縦 0.5 倍で上下反転＝欄は枠の 2 倍の高さ", () => {
    expect(editScaleStyle({ x: 1, y: -0.5 })).toEqual({ width: "100%", height: "200%", left: "0%", top: "-50%", transform: "scale(1, -0.5)" });
  });
});
