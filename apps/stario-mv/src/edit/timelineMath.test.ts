import { describe, expect, it } from "vitest";
import {
  fitPxPerFrame,
  frameToX,
  MAX_PX_PER_FRAME,
  MIN_PX_PER_FRAME,
  snapOffset,
  snapTargets,
  xToFrame,
  zoomed,
} from "./timelineMath";
import type { Composition } from "./types";

const comp: Composition = {
  id: "cmp_A",
  name: "本編",
  width: 1920,
  height: 1080,
  fps: { num: 30, den: 1 },
  durationFrames: 300,
  layers: [
    { id: "A", name: "A", type: "solid", enabled: true, locked: false, inFrame: 10, outFrame: 40, startFrame: 10 },
    { id: "B", name: "B", type: "solid", enabled: true, locked: false, inFrame: 50, outFrame: 80, startFrame: 50 },
  ],
  markers: [{ id: "mk_1", frame: 120 }],
};

describe("時刻と位置", () => {
  it("フレームと画素を行き来し、位置はいちばん近いフレームへ", () => {
    expect(frameToX(30, 4)).toBe(120);
    expect(xToFrame(121, 4)).toBe(30);
    expect(xToFrame(123, 4)).toBe(31);
  });

  it("Alt＋ホイールの拡大・縮小は範囲の中に収める", () => {
    expect(zoomed(4, -1)).toBe(5);
    expect(zoomed(5, 1)).toBe(4);
    expect(zoomed(MAX_PX_PER_FRAME, -1)).toBe(MAX_PX_PER_FRAME);
    expect(zoomed(MIN_PX_PER_FRAME, 1)).toBe(MIN_PX_PER_FRAME);
  });

  it("欄にコンポジション全体が収まる拡大率", () => {
    expect(fitPxPerFrame(600, 300)).toBe(2);
    expect(fitPxPerFrame(600, 0)).toBe(1);
    expect(fitPxPerFrame(1e9, 1)).toBe(MAX_PX_PER_FRAME);
  });
});

describe("吸着（MV-0008 決定4）", () => {
  it("吸い付く先＝今の時刻・始まりと終わり・ほかのレイヤーの端・マーカー（動かしているものは除く）", () => {
    expect(snapTargets(comp, 7, new Set(["A"])).sort((a, b) => a - b)).toEqual([0, 7, 50, 80, 120, 300]);
    expect(snapTargets(comp, 7, new Set())).toContain(40);
  });

  it("8 画素以内なら、いちばん近い先へ合わせる量を返す（遠ければ 0）", () => {
    // 1 フレーム 2 画素＝4 フレーム（8 画素）まで吸い付く
    expect(snapOffset([46], [50, 0], 2)).toBe(4);
    expect(snapOffset([45], [50], 2)).toBe(0);
    // 2つの端のうち近いほう（始まりは 2 フレーム・終わりは 1 フレーム）
    expect(snapOffset([48, 79], [50, 80], 2)).toBe(1);
    expect(snapOffset([10], [10], 2)).toBe(0);
  });
});
