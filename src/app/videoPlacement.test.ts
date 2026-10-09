// 実映像（`<video>`）の置き方（ADR-0059）＝書き出しの SVG のゆがみと同じ絵にする。
import { describe, expect, it } from "vitest";
import { warpedPlacement } from "./videoPlacement";

const rect = { x: 100, y: 50, w: 200, h: 100 };

describe("warpedPlacement", () => {
  it("ゆがみが無ければ今までどおり（回転だけ）", () => {
    expect(warpedPlacement(rect, 0, undefined)).toEqual({ x: 100, y: 50 });
    expect(warpedPlacement(rect, 30, undefined)).toEqual({ x: 100, y: 50, transform: "rotate(30deg)" });
  });

  it("左右反転は、中心を行列で移して左右を裏返す", () => {
    // 部品の箱の中心 200 の縦線で反転＝矩形の中心 (200,100) は動かない。
    const p = warpedPlacement(rect, 0, [-1, 0, 0, 1, 400, 0]);
    expect([p.x, p.y]).toEqual([100, 50]);
    expect(p.transform).toBe("matrix(-1, 0, 0, 1, 0, 0)");
  });

  it("部品の中で片側にある動画は、鏡の位置へ移る", () => {
    // 部品の中心が x=500 のとき、中心 x=200 の動画は x=800 へ。
    const p = warpedPlacement(rect, 0, [-1, 0, 0, 1, 1000, 0]);
    expect([p.x, p.y]).toEqual([700, 50]);
  });

  it("回っている動画は「ゆがみ × 回転」を掛ける", () => {
    const p = warpedPlacement(rect, 90, [-1, 0, 0, 1, 400, 0]);
    // A·R(90)＝[-1 0; 0 1]·[0 -1; 1 0]＝[0 1; 1 0] → matrix(p11=0, p21=1, p12=1, p22=0)。
    const m = p.transform!.match(/matrix\(([^)]+)\)/)![1].split(",").map(Number);
    [0, 1, 1, 0].forEach((v, i) => expect(Math.abs(m[i] - v) < 1e-9).toBe(true));
  });
});
