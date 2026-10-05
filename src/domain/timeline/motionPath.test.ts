// 動きの道筋と点（ADR-0054 段階2）。
import { describe, expect, it } from "vitest";
import { EASING } from "../enums";
import type { Keyframe } from "../project/types";
import { interpolateKeyframes } from "../project/keyframes";
import { keyPositionAfterDrag, MOTION_PATH_SAMPLES, motionPathOf } from "./motionPath";

const box = { x: 100, y: 200, w: 40, h: 20 }; // 中心 (120, 210)

describe("motionPathOf", () => {
  it("位置を動かすキーが無ければ描かない（拡縮・濃さだけの動き）", () => {
    expect(motionPathOf(box, [], 4)).toBeNull();
    expect(motionPathOf(box, [{ timeSec: 0, scale: 1 }, { timeSec: 2, scale: 2, opacity: 0.5 }], 4)).toBeNull();
  });

  it("点は位置のずれを足した中心・時刻順。拡縮や回転があっても中心は動かない", () => {
    const kfs: Keyframe[] = [
      { timeSec: 2, x: 300, y: -50, scale: 3, rotation: 90 },
      { timeSec: 0, x: 0, y: 0, scale: 1 },
    ];
    const p = motionPathOf(box, kfs, 4)!;
    expect(p.keys).toEqual([{ timeSec: 0, x: 120, y: 210 }, { timeSec: 2, x: 420, y: 160 }]);
  });

  it("線は描画と同じ補間をなぞる（緩急がある区間も・キーの時刻を必ず通る）", () => {
    const kfs: Keyframe[] = [{ timeSec: 0, x: 0 }, { timeSec: 1.234, x: 100, easing: EASING.easeInOut }, { timeSec: 3, x: 0 }];
    const p = motionPathOf(box, kfs, 3)!;
    expect(p.line.length).toBe(MOTION_PATH_SAMPLES + 1 + 1); // 等分 61 点＋割り切れないキーの時刻
    expect(p.line).toContainEqual({ x: 220, y: 210 }); // 1.234 秒の点
    // 等分の 1 点（0.5 秒）＝描画の補間と同じ値
    expect(p.line[10].x).toBeCloseTo(120 + interpolateKeyframes(kfs, 0.5).x!, 9);
    // 時刻順に並ぶ＝線が行き来しない（1.234 秒の点は 1.2 秒と 1.25 秒の間）
    const at = p.line.findIndex((q) => q.x === 220);
    expect(at).toBe(25);
  });

  it("帯の長さの外にあるキーは点にしない（掴むと別の時刻に点が増える）", () => {
    const kfs: Keyframe[] = [{ timeSec: 0, x: 0 }, { timeSec: 2, x: 50 }, { timeSec: 5, x: 100 }];
    const p = motionPathOf(box, kfs, 2)!;
    expect(p.keys.map((k) => k.timeSec)).toEqual([0, 2]);
    expect(motionPathOf(box, [{ timeSec: 5, x: 100 }], 2)).toBeNull();
  });
});

describe("keyPositionAfterDrag", () => {
  const kfs: Keyframe[] = [{ timeSec: 0, x: 0, y: 0 }, { timeSec: 1, x: 100 }, { timeSec: 2, x: 200, y: 40 }];

  it("持っている軸は元のずれに足すだけ（時刻は変えない）", () => {
    expect(keyPositionAfterDrag(kfs, 0, 5, -3)).toEqual({ x: 5, y: -3 });
  });

  it("持っていない軸は、動かさなければ外したまま（null）＝触っていない縦の緩急を変えない", () => {
    expect(keyPositionAfterDrag(kfs, 1, 30, 0.5)).toEqual({ x: 130, y: null });
  });

  it("持っていない軸を動かしたら、その時刻に描かれているずれから書き足す（掴んだ瞬間に飛ばない）", () => {
    // 1 秒の縦のずれは 0 と 40 の間＝20
    expect(keyPositionAfterDrag(kfs, 1, 0, 10)).toEqual({ x: 100, y: 30 });
  });

  it("境目：1px ちょうどは書き足す", () => {
    expect(keyPositionAfterDrag(kfs, 1, 0, 1).y).toBe(21);
    expect(keyPositionAfterDrag(kfs, 1, 0, -0.99).y).toBeNull();
  });

  it("横の値を持たないキーも同じ（縦だけ引いたら横は外したまま）", () => {
    const ys: Keyframe[] = [{ timeSec: 0, x: 0, y: 0 }, { timeSec: 1, y: 50 }, { timeSec: 2, x: 200, y: 0 }];
    expect(keyPositionAfterDrag(ys, 1, 0.5, 10)).toEqual({ x: null, y: 60 });
    expect(keyPositionAfterDrag(ys, 1, 5, 0)).toEqual({ x: 105, y: 50 });
  });

  it("その時刻にキーが無ければ何も変えない", () => {
    expect(keyPositionAfterDrag(kfs, 0.5, 10, 10)).toEqual({});
  });
});
