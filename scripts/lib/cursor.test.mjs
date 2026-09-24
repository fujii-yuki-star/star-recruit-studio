// 仮想カーソルの絵と動き（#1227・ADR-0046 ③）。**純粋関数を直接叩く**。
import { describe, expect, it } from "vitest";
import {
  CURSOR_H, CURSOR_W, RIPPLE_SIZE, SCALE_NOT_100_MESSAGE,
  artCentroid, cursorAt, cursorPath, cursorPixels, expectedCursorCenter, expectedMarkCenter,
  positionExpr, ripplePixels, RIPPLE_SEC, SETTLE_SEC, stillTimes, TAIL_GUARD_SEC, toVideoPoint, TRAVEL_SEC,
} from "./cursor.mjs";

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

  // ⚠️ **拡大率は掛けない**（PR #1237 レビュー 🟡）＝`offsetX` 自体が
  //   「CSS px − 物理 px」なので、`dpr !== 1` では**掛けても直らない**。撮る側・焼く側とも**断る**。
  it("拡大率は掛けない（掛け算で誤魔化さない）", () => {
    expect(toVideoPoint({ offsetX: 10, offsetY: 40, dpr: 1.25 }, 100, 200), "掛け算で辻褄を合わせている").toEqual({ x: 110, y: 240 });
  });

  // ⚠️ **断り文は「次の行動」を出す**（§2-5）＝原因だけ言って終わらない。
  it("100% でないときの断りは、何をすればよいかを言う", () => {
    const m = SCALE_NOT_100_MESSAGE(1.25);
    expect(m).toContain("125%");
    expect(m, "次の行動が無い").toContain("100% にしてから");
  });
});

// ⚠️ **焼いた結果の検査は、この重心を期待値にする**（PR #1237 レビュー 🟡）＝
// 「押した点」を期待値にしていた頃は、**輪が左右対称**なので**カーソルが1画素も無くても通った**。
describe("焼く絵の重心（検査の期待値）", () => {
  it("塗られていなければ null（空の絵を期待値にしない）", () => {
    expect(artCentroid(new Uint8Array(4 * 4 * 4), 4, 4)).toBeNull();
  });

  it("塗られた所の真ん中と、その数を返す", () => {
    const px = new Uint8Array(4 * 4 * 4);
    for (const [x, y] of [[1, 2], [3, 2]]) px[(y * 4 + x) * 4 + 3] = 255;
    expect(artCentroid(px, 4, 4)).toEqual({ x: 2, y: 2, count: 2 });
  });

  // ⚠️ **輪の重心は押した点そのもの**＝だからこれ**だけ**を見ていては検査にならない（上の理由）。
  it("輪だけなら、中心は押した点", () => {
    const rip = artCentroid(ripplePixels(), RIPPLE_SIZE, RIPPLE_SIZE);
    expect(rip.x).toBeCloseTo(RIPPLE_SIZE / 2 - 0.5, 1);
    expect(rip.y).toBeCloseTo(RIPPLE_SIZE / 2 - 0.5, 1);
  });

  // ⚠️ **カーソルは右下に広がる**（先端が (0,0)）＝重心は押した点より右下になる。
  it("カーソルだけの重心は、押した点の右下", () => {
    const c = expectedCursorCenter({ x: 100, y: 200 });
    expect(c.x, "押した点と同じ＝カーソルの形を見ていない").toBeGreaterThan(100);
    expect(c.y).toBeGreaterThan(200);
    expect(c.count).toBeGreaterThan(50);
  });

  // ⚠️ **押した瞬間の期待値は、輪とカーソルの重み付き**＝カーソルのぶんだけ押した点からずれる。
  it("押した瞬間の重心は、輪だけの位置から、カーソルのぶんずれる", () => {
    const m = expectedMarkCenter({ x: 100, y: 200 });
    expect(m.x, "カーソルを数えていない（輪だけを見ている）").toBeGreaterThan(100);
    expect(m.count).toBe(
      artCentroid(cursorPixels(), CURSOR_W, CURSOR_H).count + artCentroid(ripplePixels(), RIPPLE_SIZE, RIPPLE_SIZE).count,
    );
  });
});

// ⚠️ **同じ意味を2つの言語で二重に書かない**（PR #1237 レビュー 🟡）＝`overlay` へ渡す式と
// `cursorAt` は**同じ動き**でなければならないのに、以前は**別々に組み立てていた**（端の扱いまで別）。
describe("位置の式（`overlay` と `cursorAt` が同じ木から出る）", () => {
  const path = cursorPath([{ atSec: 2, x: 100, y: 200 }, { atSec: 5, x: 400, y: 300 }]);
  /** `js` 版の式を、その場で評価できる関数にする。 */
  const asFn = (axis) => new Function("t", `return ${positionExpr(path, axis, "js")};`);

  it("`cursorAt` と同じ位置を返す（ずれたら焼いた絵と検査が食い違う）", () => {
    const fx = asFn("x");
    const fy = asFn("y");
    for (let t = 0; t <= 6; t += 0.1) {
      const want = cursorAt(path, t);
      // ⚠️ 丸めのぶんだけ許す（`cursorAt` は整数に丸め、式は丸めない）。
      expect(Math.abs(fx(t) - want.x), `${t.toFixed(1)}s で x がずれている`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(fy(t) - want.y), `${t.toFixed(1)}s で y がずれている`).toBeLessThanOrEqual(0.5);
    }
  });

  it("ffmpeg 版は ffmpeg の書き方（JS の三項演算子を出さない）", () => {
    const e = positionExpr(path, "x");
    expect(e).toContain("if(lt(t,");
    expect(e, "JS の書き方が混ざっている＝ffmpeg が式を読めない").not.toContain("?");
  });

  it("枝の数は、どちらの書き方でも同じ", () => {
    const count = (s, re) => (s.match(re) ?? []).length;
    expect(count(positionExpr(path, "x"), /if\(/g)).toBe(count(positionExpr(path, "x", "js"), /\?/g));
  });

  it("押す場所が無ければ 0（式が空にならない）", () => {
    expect(positionExpr([], "x")).toBe("0");
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

// ⚠️ **カーソル本体を見る時刻**（#1227・PR #1237 再レビュー 🟡）。
// 輪だけ見ていると**カーソルが1画素も描かれていなくても通る**ので、ここが検査の目になる。
describe("カーソルだけが止まっている時刻", () => {
  /** 押す間隔 `gap` で `n` 回押す台本。 */
  const script = (n, gap, first = 3) =>
    Array.from({ length: n }, (_, i) => ({ atSec: first + i * gap, x: 100 + i * 50, y: 200 }));

  it("押下ごとに、押す直前の溜めを1つ見る", () => {
    const points = script(3, 1.5);
    const stills = stillTimes(cursorPath(points), points, 12);
    for (const p of points) {
      expect(stills.some((t) => t >= p.atSec - SETTLE_SEC && t < p.atSec), `${p.atSec}s の押下を見ていない`).toBe(true);
    }
  });

  // ⚠️ **窓の途中から輪が出る形も断る**＝`cursorPath` の作りでは起きないが、この関数は
  //   道筋と押下を別々に受け取るので、**呼び方しだいで起きる**。起きたら重心に輪が混ざる。
  //   ⚠️ この枝を試さないと、**門を外しても検査が緑のまま**だった（変異が生き残った）。
  it("止まっている窓の途中で押される形も、選ばない", () => {
    const path = [{ atSec: 0, x: 100, y: 200 }, { atSec: 10, x: 100, y: 200 }];
    const stills = stillTimes(path, [{ atSec: 5, x: 100, y: 200 }], 12);
    // 0〜10 の窓は**途中で押される**ので捨てる（最後の点より後ろの窓は残ってよい）。
    expect(stills.filter((t) => t < 10), "輪をまたぐ窓を選んでいる").toEqual([]);
  });

  // ⚠️ **輪の出ている間は選ばない**＝カーソルだけを見たいのに、輪が混ざると重心がずれる。
  it("輪が出ている時刻は選ばない", () => {
    const points = script(3, 1.5);
    const stills = stillTimes(cursorPath(points), points, 12);
    for (const t of stills) {
      const inRipple = points.some((p) => p.atSec <= t && t <= p.atSec + RIPPLE_SEC);
      expect(inRipple, `${t}s は輪が出ている`).toBe(false);
    }
  });

  // ⚠️ **動いている最中は選ばない**＝コマの取り出しが 1/15 秒ずれるだけで 30 画素動く
  //   （実測で 22 画素ずれて落ちた）。選ぶのは、同じ位置が続いている区間だけ。
  it("動いている最中は選ばない", () => {
    const points = script(2, 2);
    const path = cursorPath(points);
    for (const t of stillTimes(path, points, 10)) {
      const a = cursorAt(path, t - 0.05);
      const b = cursorAt(path, t + 0.05);
      expect({ ...a }, `${t}s は動いている`).toEqual({ ...b });
    }
  });

  // ⚠️ **録画の終わりをまたがない**＝`totalSec` は ffmpeg を起こしてからの秒で、
  //   **実尺はそれより数百 ms 短い**。またぐと「コマを取り出せません」で落ちる。
  // ⚠️ **最後の押下を終わり際に置いて測る**＝余裕のある台本だと、安全代を外しても
  //   同じ結果になってしまい、**この振る舞いを一度も試していない**ことになる（変異が生き残った）。
  it("録画の終わり際は選ばない（実尺は totalSec より短い）", () => {
    const points = script(2, 1.5);
    const totalSec = points[points.length - 1].atSec + 1;
    for (const t of stillTimes(cursorPath(points), points, totalSec)) {
      expect(t, "終わり際を選んでいる").toBeLessThanOrEqual(totalSec - TAIL_GUARD_SEC);
    }
  });

  it("押す場所が無ければ、何も選ばない", () => {
    expect(stillTimes([], [], 10)).toEqual([]);
  });

  // ⚠️ **詰めた台本では痩せる**＝「0個か否か」ではなく**押下ごとに見られているか**を数える理由。
  //   ⚠️ 道筋を**手で組んで**渡す（`cursorPath` は近すぎる間隔を入口で断るようになったため）。
  it("押下が輪の中に埋もれると、その押下は見られない", () => {
    const points = [{ atSec: 3, x: 100, y: 200 }, { atSec: 3.3, x: 150, y: 200 }];
    const path = [
      { atSec: 2.2, x: 20, y: 110 }, { atSec: 2.75, x: 100, y: 200 }, { atSec: 3, x: 100, y: 200, click: true },
      { atSec: 3.05, x: 100, y: 200 }, { atSec: 3.3, x: 150, y: 200, click: true },
    ];
    const stills = stillTimes(path, points, 10);
    const seen = points.filter((p) => stills.some((t) => t >= p.atSec - SETTLE_SEC && t < p.atSec));
    expect(seen.length, "詰めても全部見えているなら、窓の取り方が甘い").toBeLessThan(points.length);
  });
});

// ⚠️ **原因の所で断る**（PR #1237 3回目 ℹ️）＝近すぎると `atSec` が前後して、
// 位置の式も `cursorAt` も意味を失う。焼いた後に落ちても、理由が読めない。
describe("押す間隔が近すぎるとき", () => {
  it("道筋を作る所で断る（次の行動つき）", () => {
    const points = [{ atSec: 3, x: 1, y: 2 }, { atSec: 3.5, x: 3, y: 4 }];
    expect(() => cursorPath(points), "前後する道筋を黙って作っている").toThrow(/間隔が近すぎます/);
    expect(() => cursorPath(points)).toThrow(/0\.85s 以上あけて/);
  });

  it("足りていれば通す（境目で正しい台本を落とさない）", () => {
    expect(() => cursorPath([{ atSec: 3, x: 1, y: 2 }, { atSec: 3 + TRAVEL_SEC + SETTLE_SEC, x: 3, y: 4 }])).not.toThrow();
  });
});
