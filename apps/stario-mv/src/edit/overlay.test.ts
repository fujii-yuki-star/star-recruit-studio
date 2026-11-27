import { describe, expect, it } from "vitest";
import { dragDelta, insideQuad, movePositionOp, pickLayerAt, toPanel, type Bounds, type Point } from "./overlay";
import { assetSummary } from "./AssetsPanel";
import type { Layer } from "./types";

const sq = (x: number, y: number, w: number, h: number): [Point, Point, Point, Point] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

describe("枠の当たり（MV-0008 決定6）", () => {
  it("凸の四角の中か（どちら回りでも・辺の上は中・傾いていても）", () => {
    const q = sq(0, 0, 10, 10);
    expect(insideQuad(q, [5, 5])).toBe(true);
    expect(insideQuad(q, [10, 5])).toBe(true);
    expect(insideQuad(q, [11, 5])).toBe(false);
    expect(insideQuad([...q].reverse(), [5, 5])).toBe(true);
    const diamond: Point[] = [
      [5, 0],
      [10, 5],
      [5, 10],
      [0, 5],
    ];
    expect(insideQuad(diamond, [5, 5])).toBe(true);
    expect(insideQuad(diamond, [1, 1])).toBe(false);
  });

  it("窓の画素（物理）→ 欄の CSS 画素（画素比で割って欄の左上を引く）", () => {
    expect(toPanel([300, 200], 100, 40, 2)).toEqual([50, 60]);
  });

  it("いちばん手前のレイヤーを選ぶ（先頭が手前）・錠は飛ばす・無ければ null", () => {
    const b: Bounds = {
      frame: 0,
      scale: 1,
      layers: [
        { layerId: "front", corners: sq(0, 0, 20, 20) },
        { layerId: "back", corners: sq(0, 0, 100, 100) },
      ],
    };
    expect(pickLayerAt(b, [10, 10], 0, 0, 1, new Set())).toBe("front");
    expect(pickLayerAt(b, [50, 50], 0, 0, 1, new Set())).toBe("back");
    expect(pickLayerAt(b, [10, 10], 0, 0, 1, new Set(["front"]))).toBe("back");
    expect(pickLayerAt(b, [500, 500], 0, 0, 1, new Set())).toBeNull();
    // 欄の位置と画素比で写してから当てる（欄が (100, 0)・画素比 2＝back の窓 0〜100 は欄の -100〜-50）
    expect(pickLayerAt(b, [-80, 5], 100, 0, 2, new Set())).toBe("back");
    expect(pickLayerAt(b, [-30, 5], 100, 0, 2, new Set())).toBeNull();
    const shifted: Bounds = { ...b, layers: [{ layerId: "x", corners: sq(200, 0, 40, 40) }] };
    expect(pickLayerAt(shifted, [10, 10], 100, 0, 2, new Set())).toBe("x");
  });
});

describe("掴んで動かす量（MV-0008 決定6）", () => {
  it("欄の CSS 画素 → コンポジションの画素（画素比÷倍率）・Shift は大きいほうだけ", () => {
    // 画素比 2・コンポジションの 1 画素が窓の 0.5 画素＝CSS 1 画素はコンポジションの 4 画素
    expect(dragDelta(3, 1, 2, 0.5, false)).toEqual([12, 4]);
    expect(dragDelta(3, 1, 2, 0.5, true)).toEqual([12, 0]);
    expect(dragDelta(1, -3, 2, 0.5, true)).toEqual([0, -12]);
    expect(dragDelta(5, 5, 1, 0, false)).toEqual([0, 0]);
  });

  it("位置を動かす（固定値なら値・キーフレームなら今の時刻のキー）", () => {
    const l: Layer = {
      id: "A",
      name: "A",
      type: "solid",
      enabled: true,
      locked: false,
      inFrame: 0,
      outFrame: 10,
      startFrame: 0,
      transform: { position: { value: [100, 50] } },
    };
    expect(movePositionOp(l, 3, [100, 50], [10, -5]).patch).toEqual({ transform: { position: { value: [110, 45] } } });
    const k: Layer = {
      ...l,
      transform: { position: { keyframes: [{ frame: 0, value: [0, 0], interpolation: "linear" }] } },
    };
    expect(movePositionOp(k, 3, [7, 7], [1, 1]).patch).toEqual({
      transform: {
        position: {
          keyframes: [
            { frame: 0, value: [0, 0], interpolation: "linear" },
            { frame: 3, value: [8, 8], interpolation: "linear" },
          ],
        },
      },
    });
  });
});

describe("素材の一覧の1行（MV-0008 決定7）", () => {
  it("大きさ・長さ（無ければコマ数）・透過・指紋の有無", () => {
    expect(
      assetSummary({ id: "a", kind: "video", name: "v", sha256: "x", meta: { width: 640, height: 360, durationSec: 2.5 } }),
    ).toBe("640×360・2.5 秒・指紋あり");
    expect(assetSummary({ id: "b", kind: "imageSequence", name: "s", meta: { frameCount: 48, hasAlpha: true } })).toBe(
      "48 コマ・透過・指紋なし",
    );
    expect(assetSummary({ id: "c", kind: "audio", name: "a" })).toBe("指紋なし");
  });
});
