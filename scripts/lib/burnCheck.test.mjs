// 焼いた印の判定（#1227・PR #1237 再レビュー 🟡）。**純粋関数を直接叩く**。
//
// ⚠️ **この判定はもともと `tutorialCursor.mjs` の中にあった**＝ffmpeg を起こす所に埋まっていて、
// **いちばん効かせたい判定が変異チェックに掛かっていなかった**。切り出したのでここで叩く。
import { describe, expect, it } from "vitest";
import {
  AWAY_LIMIT, CHECK_H, CHECK_W, VIEW_HEIGHT_SHRINK, VIEW_ORIGIN_SLACK, VIEW_WIDTH_SHRINK,
  expectedCheckCount, markVerdict, toCheckPoint, viewVerdict,
} from "./burnCheck.mjs";
import { expectedCursorCenter } from "./cursor.mjs";

const size = { w: 1296, h: 838 };

describe("録画の画素 → 縮めた格子", () => {
  // ⚠️ **画素の中心で測る**＝比を掛けるだけだと、常に半画素ぶん外側へ寄る。
  it("画素の中心で測る（端でずれない）", () => {
    const left = toCheckPoint({ x: 0, y: 0 }, size);
    expect(left.x, "画素の中心を採っていない").toBeCloseTo(0.5 / size.w * CHECK_W - 0.5, 6);
    const right = toCheckPoint({ x: size.w - 1, y: size.h - 1 }, size);
    expect(right.x).toBeCloseTo(CHECK_W - 0.5 - (0.5 / size.w) * CHECK_W, 6);
  });

  it("真ん中は真ん中", () => {
    const mid = toCheckPoint({ x: size.w / 2 - 0.5, y: size.h / 2 - 0.5 }, size);
    expect(mid.x).toBeCloseTo(CHECK_W / 2 - 0.5, 6);
    expect(mid.y).toBeCloseTo(CHECK_H / 2 - 0.5, 6);
  });

  it("画素の数は、面積の比で縮む", () => {
    expect(expectedCheckCount({ count: size.w * size.h }, size)).toBeCloseTo(CHECK_W * CHECK_H, 6);
  });
});

describe("焼いた印の判定", () => {
  const want = { x: 400, y: 300, count: 1200 };
  const at = toCheckPoint(want, size);
  const expectedCount = expectedCheckCount(want, size);
  const ok = { x: at.x, y: at.y, count: expectedCount };

  it("合っていれば null（正しく焼けた回を落とさない）", () => {
    expect(markVerdict(ok, want, size)).toBeNull();
  });

  // ⚠️ **何も描かれていない**＝焼く指定そのものが効いていない。
  it("変わった所が無ければ、次の行動を言う", () => {
    const why = markVerdict(null, want, size);
    expect(why).toContain("何も描かれていません");
    expect(why, "次の行動が無い").toContain("見直してください");
  });

  // ⚠️ **ここが締まっていないと、この道具は何も守らない**（前は 6 で、ずれを通していた）。
  it("許容より離れていれば落とす", () => {
    const off = { x: at.x + AWAY_LIMIT + 0.01, y: at.y, count: expectedCount };
    expect(markVerdict(off, want, size), "許容を超えたのに通している").toMatch(/ずれています/);
  });

  it("許容の内側なら通す（境目でがたつかない）", () => {
    const near = { x: at.x + AWAY_LIMIT - 0.01, y: at.y, count: expectedCount };
    expect(markVerdict(near, want, size)).toBeNull();
  });

  // ⚠️ **広すぎる**＝画面そのものの変化が混ざっている＝重心の値に意味が無い。
  it("変わった所が広すぎれば落とす（別の変化が混ざっている）", () => {
    expect(markVerdict({ ...ok, count: expectedCount * 10 }, want, size)).toMatch(/広すぎます/);
  });

  // ⚠️ **薄すぎる**＝カーソルが数画素しか描かれていなくても、重心さえ合えば通ってしまう。
  // ⚠️ **整数の画素数で見る**（PR #1237 3回目 🟡）＝`changedCenter` は整数しか返さないのに、
  //   以前の検査は `想定 / 100 = 0.18` という**到達しない値**で緑にしていた。しかも当時の式
  //   （`count * 6 < 想定`）は**0 のときしか鳴らず**、0 は上の `!center` で既に捕まっていた
  //   ＝**鳴りえない門**を、前回指摘された型のまま作っていた。
  it("変わった所が薄すぎれば落とす（実際に返りうる整数で見る）", () => {
    expect(Number.isInteger(2)).toBe(true);
    expect(markVerdict({ ...ok, count: 2 }, want, size), "欠けたまま通している").toMatch(/薄すぎます/);
  });

  // ⚠️ **実測の値で見る**＝本物のカーソルの絵から想定を出し、実際に出た数（明 8〜9／暗 6〜7）が
  //   通ることを確かめる。下限を締めすぎると**正しく焼けた回を落とす**。
  // ⚠️ **カーソルだけの想定は 5 画素そこそこ**＝ここで「想定の何倍」ではなく「何割」で見ないと、
  //   門が**0 のときしか鳴らない**（そして 0 は上の `!center` で既に捕まっている）。
  it("カーソルだけの想定でも、欠けていれば落とす（門が 0 でしか鳴らない式にしない）", () => {
    const cur = expectedCursorCenter({ x: 400, y: 300 });
    const at = toCheckPoint(cur, size);
    expect(expectedCheckCount(cur, size), "想定が大きすぎて、この検査が効かない").toBeLessThan(8);
    expect(markVerdict({ x: at.x, y: at.y, count: 2 }, cur, size), "2 画素しか描けていないのに通している").toMatch(/薄すぎます/);
  });

  it("実機で出た画素数は通す（明 8〜9 / 暗 6〜7）", () => {
    const cur = expectedCursorCenter({ x: 400, y: 300 });
    const at = toCheckPoint(cur, size);
    for (const count of [6, 7, 8, 9]) {
      expect(markVerdict({ x: at.x, y: at.y, count }, cur, size), `${count} 画素で落ちる`).toBeNull();
    }
  });

  it("小さな絵でも、数の下限で落としきらない", () => {
    const tiny = { x: 10, y: 10, count: 40 };
    const tat = toCheckPoint(tiny, size);
    expect(markVerdict({ x: tat.x, y: tat.y, count: 1 }, tiny, size)).toBeNull();
  });
});

// ⚠️ **`view` を見る唯一の目**＝計算した値で描いて同じ値で検査しても、間違いは見えない。
describe("録画から測った中身の矩形と、計算した view の突き合わせ", () => {
  const view = { offsetX: 8, offsetY: 31, width: 1280, height: 800 };
  const exact = { x: 8, y: 31, w: 1280, h: 800 };

  it("一致していれば、何も言わない", () => {
    expect(viewVerdict(exact, view)).toEqual([]);
  });

  // ⚠️ **これが実際に捕まえた形**＝起動直後の窓の動きで、高さが 33 画素古かった。
  it("高さが 33 画素ずれていれば言う（実際に捕まえた形）", () => {
    expect(viewVerdict({ ...exact, h: 767 }, view).join(" ")).toContain("高さ 767");
  });

  it("位置が少しでもずれていれば言う", () => {
    expect(viewVerdict({ ...exact, x: 8 + VIEW_ORIGIN_SLACK + 1 }, view).join(" ")).toContain("左 ");
    expect(viewVerdict({ ...exact, y: 31 - VIEW_ORIGIN_SLACK - 1 }, view).join(" ")).toContain("上 ");
  });

  // ⚠️ **縦スクロールバーのぶんは許す**＝`position:fixed` は縦の帯の内側までしか広がらない。
  it("幅は、縦スクロールバーのぶんだけ小さくても通す", () => {
    expect(viewVerdict({ ...exact, w: 1280 - VIEW_WIDTH_SHRINK + 1 }, view)).toEqual([]);
  });

  // ⚠️ **許容はスクロールバーぶんまで**＝それを超える緩みを入れると、**実際に起きた取り違え**
  //   （高さ 33 画素）が黙って通る。幅・高さとも、Windows のスクロールバー（15〜17 画素）が上限。
  it("許容はスクロールバーぶんまで（それ以上は緩めない）", () => {
    expect(VIEW_WIDTH_SHRINK, "幅の許容が広すぎる").toBeLessThanOrEqual(20);
    expect(VIEW_HEIGHT_SHRINK, "高さの許容が広すぎる").toBeLessThanOrEqual(20);
    expect(viewVerdict({ ...exact, h: 800 - VIEW_HEIGHT_SHRINK - 1 }, view).join(" ")).toContain("高さ ");
    expect(viewVerdict({ ...exact, w: 1280 - VIEW_WIDTH_SHRINK - 1 }, view).join(" ")).toContain("幅 ");
  });

  it("大きすぎるのも言う（別のものを測っている）", () => {
    expect(viewVerdict({ ...exact, w: 1400 }, view).join(" ")).toContain("幅 1400");
  });
});
