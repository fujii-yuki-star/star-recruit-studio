import { describe, expect, it } from "vitest";
import {
  cubicBezierEase,
  handleFromSpeed,
  handleFromValue,
  setHandleOp,
  setKeyValueOp,
  speedAt,
  speedHandles,
  valueAt,
  valueHandles,
  valueRange,
} from "./graph";
import type { Keyframe, Layer } from "./types";

const kf = (frame: number, value: number | number[], interpolation: Keyframe["interpolation"] = "linear", extra: Partial<Keyframe> = {}): Keyframe => ({
  frame,
  value,
  interpolation,
  ...extra,
});

describe("進み方（MV-0015＝描画の核と同じ数）", () => {
  it("⚠️ `mv-core` の eval.rs の「進み方は画面のグラフと同じ数」と同じ表", () => {
    const cases: [number[], number[], number, number][] = [
      [[1 / 3, 0], [2 / 3, 1], 0.25, 0.15625],
      [[0.42, 0], [0.58, 1], 0.25, 0.129161931047],
      [[0.1, 0.9], [0.2, 1.5], 0.5, 1.180729155059],
      [[0.8, -0.5], [0.9, 0.3], 0.7, -0.034501767812],
      [[1 / 3, 1 / 3], [2 / 3, 2 / 3], 0.6, 0.6],
    ];
    for (const [a, b, t, want] of cases) expect(Math.abs(cubicBezierEase(a, b, t) - want)).toBeLessThan(1e-9);
  });

  it("値＝止める・直線・曲線・キーの外", () => {
    const keys = [kf(0, [0, 10]), kf(10, [100, 10], "hold"), kf(20, [0, 0], "bezier", { easeOut: [1 / 3, 0] }), kf(30, [100, 100], "linear", { easeIn: [2 / 3, 1] })];
    expect(valueAt(keys, -5)).toEqual([0, 10]);
    expect(valueAt(keys, 5)).toEqual([50, 10]);
    expect(valueAt(keys, 15)).toEqual([100, 10]);
    const v = valueAt(keys, 22.5);
    expect(v[0]).toBeCloseTo(15.625, 9);
    expect(v[1]).toBeCloseTo(15.625, 9);
    expect(valueAt(keys, 99)).toEqual([100, 100]);
    expect(valueAt([], 3)).toEqual([]);
  });

  it("速さ＝1秒あたりの変わり方の大きさ（直線は平均・止めるとキーの外は 0）", () => {
    const keys = [kf(0, [0, 0]), kf(30, [30, 40], "hold"), kf(60, 0)];
    // 30 フレーム（1 秒）で長さ 50
    expect(speedAt(keys, 10, 30)).toBeCloseTo(50, 6);
    expect(speedAt(keys, 40, 30)).toBe(0);
    expect(speedAt(keys, -1, 30)).toBe(0);
    expect(speedAt(keys, 70, 30)).toBe(0);
    // イージーイーズ＝始まりと終わりは 0・真ん中は平均の 1.5 倍
    const ease = [kf(0, 0, "bezier", { easeOut: [1 / 3, 0] }), kf(30, 90, "linear", { easeIn: [2 / 3, 1] })];
    expect(speedAt(ease, 0, 30)).toBeLessThan(1);
    expect(speedAt(ease, 15, 30)).toBeCloseTo(135, 1);
  });
});

describe("取っ手（MV-0015 決定2・3）", () => {
  const keys = [kf(0, [0, 5], "bezier", { easeOut: [0.25, 0.1] }), kf(20, [100, 5], "linear", { easeIn: [0.5, 1.2] }), kf(40, [0, 0])];

  it("値のグラフ＝曲線の区間だけ・値の差が 0 の成分には出さない・行き過ぎた値の割合もそのまま", () => {
    expect(valueHandles(keys)).toEqual([
      { i: 0, side: "out", comp: 0, from: { frame: 0, value: 0 }, at: { frame: 5, value: 10 } },
      { i: 0, side: "in", comp: 0, from: { frame: 20, value: 100 }, at: { frame: 10, value: 120 } },
    ]);
    // 動かした先 → 取っ手の値（時間は 0〜1 に収める・値の割合は超えてよい）
    const h = valueHandles(keys)[1];
    expect(handleFromValue(keys, h, { frame: 15, value: 130 })).toEqual([0.75, 1.3]);
    expect(handleFromValue(keys, h, { frame: 99, value: -50 })).toEqual([1, -0.5]);
    expect(handleFromValue(keys, h, { frame: -9, value: 0 })).toEqual([0, 0]);
  });

  it("速さのグラフ＝影響と速さ（AE と同じ）・動かした先から取っ手の値へ戻る", () => {
    // 20 フレームで 100 ＝ 平均 150/秒（30fps）
    const hs = speedHandles(keys, 30);
    expect(hs).toHaveLength(2);
    expect(hs[0].at.frame).toBe(5);
    expect(hs[0].at.value).toBeCloseTo(0.4 * 150, 9);
    expect(hs[1].at.frame).toBe(10);
    expect(hs[1].at.value).toBeCloseTo((-0.2 / 0.5) * 150, 9);
    // 出：影響 50%・速さ 300 → [0.5, 1]／入り：影響 25%・速さ 0 → [0.75, 1]
    expect(handleFromSpeed(keys, hs[0], { frame: 10, value: 300 }, 30)).toEqual([0.5, 1]);
    expect(handleFromSpeed(keys, hs[1], { frame: 15, value: 0 }, 30)).toEqual([0.75, 1]);
    // 影響は 1〜100%・速さは負にしない
    expect(handleFromSpeed(keys, hs[0], { frame: -5, value: -10 }, 30)).toEqual([0.01, 0]);
    expect(handleFromSpeed(keys, hs[1], { frame: 50, value: 150 }, 30)[0]).toBeCloseTo(0.99, 9);
    // 値が変わらない区間には出さない
    expect(speedHandles([kf(0, 3, "bezier"), kf(10, 3)], 30)).toEqual([]);
  });

  it("取っ手とキーの値を書く取引（出＝始まりのキー・入り＝次のキー・錠は null）", () => {
    const l: Layer = {
      id: "A",
      name: "A",
      type: "solid",
      enabled: true,
      locked: false,
      inFrame: 0,
      outFrame: 50,
      startFrame: 0,
      transform: { position: { keyframes: keys } },
    };
    const kfs = (op: unknown): Keyframe[] =>
      (op as { patch: { transform: { position: { keyframes: Keyframe[] } } } }).patch.transform.position.keyframes;
    expect(kfs(setHandleOp(l, "/transform/position", { i: 0, side: "out" }, [0.4, 0]))[0].easeOut).toEqual([0.4, 0]);
    const inOp = kfs(setHandleOp(l, "/transform/position", { i: 0, side: "in" }, [0.6, 1]));
    expect(inOp[1].easeIn).toEqual([0.6, 1]);
    expect(inOp[0].easeOut).toEqual([0.25, 0.1]);
    expect(kfs(setKeyValueOp(l, "/transform/position", 1, 1, 9))[1].value).toEqual([100, 9]);
    expect(setHandleOp({ ...l, locked: true }, "/transform/position", { i: 0, side: "out" }, [0.4, 0])).toBeNull();
    expect(setKeyValueOp(l, "/transform/position", 7, 0, 1)).toBeNull();
    const r: Layer = { ...l, transform: { rotation: { keyframes: [kf(0, 0), kf(10, 90)] } } };
    expect(kfs({ patch: { transform: { position: { keyframes: (setKeyValueOp(r, "/transform/rotation", 1, 0, 45) as unknown as { patch: { transform: { rotation: { keyframes: Keyframe[] } } } }).patch.transform.rotation.keyframes } } } })[1].value).toBe(45);
  });

  it("縦の範囲＝余白 10%・幅 0 なら上下に 1", () => {
    expect(valueRange([0, 100])).toEqual([-10, 110]);
    expect(valueRange([5, 5])).toEqual([3.8, 6.2]);
    expect(valueRange([])).toEqual([0, 1]);
  });
});
