// 仮想カーソルの絵と動き（#1227・ADR-0046 ③）。**純粋関数を直接叩く**。
import { describe, expect, it } from "vitest";
import { CURSOR_H, CURSOR_W, cursorAt, cursorPath, cursorPixels, ripplePixels, toVideoPoint } from "./cursor.mjs";

/** その画素の不透明度。 */
const alphaAt = (px, x, y) => px[(y * CURSOR_W + x) * 4 + 3];

describe("カーソルの絵", () => {
  it("大きさぶんの画素がある", () => {
    expect(cursorPixels().length).toBe(CURSOR_W * CURSOR_H * 4);
  });

  // ⚠️ **先端が (0,0)**＝押した位置に**先端**が来る。中心に置くと、
  //   **押した所と指している所が半分ずれる**（教材として致命的）。
  it("先端（0,0）が塗られている", () => {
    expect(alphaAt(cursorPixels(), 0, 0), "先端が空＝押した所を指していない").toBeGreaterThan(0);
  });

  it("右下の隅は空いている（矢印であって四角ではない）", () => {
    expect(alphaAt(cursorPixels(), CURSOR_W - 1, CURSOR_H - 1)).toBe(0);
  });

  // ⚠️ **暗い画面でも見える**＝この製品にはダークモードがある（ADR-0039）。
  it("白い縁がある（暗い画面で消えない）", () => {
    const px = cursorPixels();
    let white = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] > 0 && px[i] > 200 && px[i + 1] > 200 && px[i + 2] > 200) white += 1;
    }
    expect(white, "縁が無い＝暗い画面で見えなくなる").toBeGreaterThan(20);
  });

  it("黒い本体がある（明るい画面で消えない）", () => {
    const px = cursorPixels();
    let dark = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] > 0 && px[i] < 60) dark += 1;
    }
    expect(dark).toBeGreaterThan(50);
  });
});

// ⚠️ **ここを間違えると、押した所とは違う場所に印が出る**＝「黙って別の場所を教える」。
// 実測＝窓 (182,182) / 画面の中身 (190,213) → ずれ (8,31)。
describe("画面の中の座標 → 録画の中の位置", () => {
  const view = { offsetX: 8, offsetY: 31, dpr: 1 };

  it("題字の帯と枠のぶんずらす", () => {
    expect(toVideoPoint(view, 419, 367)).toEqual({ x: 427, y: 398 });
  });

  it("左上でもずれを足す（0 のまま返さない）", () => {
    expect(toVideoPoint(view, 0, 0), "ずれを足していない").toEqual({ x: 8, y: 31 });
  });

  // ⚠️ **拡大率を掛ける**＝125% の設定では CSS の1px が録画の1画素ではない。
  it("拡大率を掛ける", () => {
    expect(toVideoPoint({ offsetX: 10, offsetY: 40, dpr: 1.25 }, 100, 200)).toEqual({ x: 135, y: 290 });
  });
});

describe("押した瞬間の輪", () => {
  const size = 56;
  const alpha = (px, x, y) => px[(y * size + x) * 4 + 3];

  // ⚠️ **中を塗らない**＝押した先のボタンが隠れると、何を押したのか分からない。
  it("中は空いている", () => {
    expect(alpha(ripplePixels(size), Math.floor(size / 2), Math.floor(size / 2))).toBe(0);
  });

  it("縁は塗られている（上下左右）", () => {
    const px = ripplePixels(size);
    const c = Math.floor(size / 2);
    for (const [x, y] of [[c, 0], [c, size - 1], [0, c], [size - 1, c]]) {
      expect(alpha(px, x, y), `(${x},${y}) が空`).toBeGreaterThan(0);
    }
  });

  // ⚠️ **四角にしない**＝UI の選択枠に見える（焼いて見て分かった）。
  it("角は空いている（四角ではなく輪）", () => {
    const px = ripplePixels(size);
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) {
      expect(alpha(px, x, y), `角 (${x},${y}) が塗られている＝四角になっている`).toBe(0);
    }
  });
});

describe("カーソルの動き", () => {
  const points = [{ atSec: 2, x: 100, y: 200 }, { atSec: 5, x: 400, y: 300 }];

  it("押す場所ごとに、動いて・止まって・押す", () => {
    const path = cursorPath(points);
    expect(path.filter((p) => p.click).length, "押した印が数と合わない").toBe(2);
  });

  // ⚠️ **押す前に止まる**＝着いてすぐ押すと、どこを押したか追えない。
  it("押す少し前には、もう押す場所に着いている", () => {
    const path = cursorPath(points, { travelSec: 0.6, settleSec: 0.25 });
    const at = cursorAt(path, 2 - 0.1);
    expect(at, "押す直前に別の場所に居る").toEqual({ x: 100, y: 200 });
  });

  it("押した瞬間は、その場所に居る", () => {
    const path = cursorPath(points);
    expect(cursorAt(path, 2)).toEqual({ x: 100, y: 200 });
    expect(cursorAt(path, 5)).toEqual({ x: 400, y: 300 });
  });

  it("移動の途中は、まっすぐ等速", () => {
    const path = cursorPath([{ atSec: 2, x: 100, y: 200 }], { travelSec: 1, settleSec: 0 });
    // 1秒かけて (最初の位置) → (100,200)。その半分。
    const start = cursorAt(path, 1);
    const mid = cursorAt(path, 1.5);
    expect(mid.x).toBe(Math.round((start.x + 100) / 2));
    expect(mid.y).toBe(Math.round((start.y + 200) / 2));
  });

  // ⚠️ **画面の外から入ってこない**＝どこから来たのか分からない動きにしない。
  it("最初の位置は、最初に押す場所の近く（画面の中）", () => {
    const path = cursorPath([{ atSec: 2, x: 100, y: 200 }]);
    expect(path[0].x).toBeGreaterThanOrEqual(0);
    expect(path[0].y).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(path[0].x - 100, path[0].y - 200)).toBeLessThan(200);
  });

  // ⚠️ **端で止める**＝0 に落とすと**左上へ飛ぶ**。
  it("始まる前と終わったあとは、端で止まる", () => {
    const path = cursorPath(points);
    expect(cursorAt(path, -10)).toEqual({ x: path[0].x, y: path[0].y });
    expect(cursorAt(path, 999)).toEqual({ x: 400, y: 300 });
  });

  it("押す場所が無ければ、何も出さない", () => {
    expect(cursorPath([])).toEqual([]);
    expect(cursorAt([], 1)).toBeNull();
  });
});
