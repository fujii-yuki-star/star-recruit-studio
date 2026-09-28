import { describe, it, expect } from "vitest";
import { gdigrabArea } from "./capture.mjs";

// ⚠️ **実機で踏んだ形をそのまま検査にする**＝画面を左に並べた環境（原点 -1920）。
const LEFT_SCREEN = { x: -1920, y: 0, w: 3840, h: 1158 };

describe("gdigrabArea", () => {
  it("切り出し位置は絶対座標のまま渡す（原点ぶんを引かない）", () => {
    const args = gdigrabArea({ x: 52, y: 52, w: 1296, h: 838 }, LEFT_SCREEN);
    expect(args).toEqual(["-offset_x", "52", "-offset_y", "52", "-video_size", "1296x838"]);
  });

  it("左の画面（負の座標）も、そのまま渡せる", () => {
    const args = gdigrabArea({ x: -1800, y: 40, w: 1280, h: 800 }, LEFT_SCREEN);
    expect(args.slice(0, 4)).toEqual(["-offset_x", "-1800", "-offset_y", "40"]);
  });

  it("はみ出していたら、撮る前に「次の行動」つきで断る", () => {
    expect(() => gdigrabArea({ x: 1000, y: 52, w: 1296, h: 838 }, LEFT_SCREEN))
      .toThrow(/右へはみ出しています[\s\S]*窓を画面の中へ動かして/);
    expect(() => gdigrabArea({ x: -2000, y: 52, w: 200, h: 200 }, LEFT_SCREEN))
      .toThrow(/左へはみ出しています/);
    expect(() => gdigrabArea({ x: 0, y: 1100, w: 200, h: 200 }, LEFT_SCREEN))
      .toThrow(/下へはみ出しています/);
    expect(() => gdigrabArea({ x: 0, y: -10, w: 200, h: 200 }, LEFT_SCREEN))
      .toThrow(/上へはみ出しています/);
  });

  it("大きさが 0 なら断る（黙って空の録画を作らない）", () => {
    expect(() => gdigrabArea({ x: 0, y: 0, w: 0, h: 800 }, LEFT_SCREEN)).toThrow(/大きさが 0/);
  });
});
