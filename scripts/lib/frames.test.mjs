// 録画が本当に動いているかの判定（#1226・ADR-0046）。**純粋関数を直接叩く**。
//
// ⚠️ **歩く形だけにしない**＝`sampleFrames` は ffmpeg を起こすので検査から叩けない。
// 判定（`sameFrame`／`distinctFrames`）を切り出してあるので、**ここを直接叩く**
//（`CLAUDE.md` §7＝拾い方を純粋関数に切り出す）。
import { describe, expect, it } from "vitest";
import { DIFF_RATIO, PIXEL_TOLERANCE, changedCenter, distinctFrames, sameFrame } from "./frames.mjs";

/** 一様な明るさのコマ。 */
const flat = (v, n = 576) => Uint8Array.from({ length: n }, () => v);

/** `n` 画素だけ `delta` ずらしたコマ（符号化の粗を真似る）。 */
const noisy = (v, count, delta, n = 576) =>
  Uint8Array.from({ length: n }, (_, i) => (i < count ? v + delta : v));

describe("同じ絵かどうか", () => {
  it("まったく同じなら同じ", () => {
    expect(sameFrame(flat(100), flat(100))).toBe(true);
  });

  // ⚠️ **完全一致で見ない**＝h264 は不可逆なので、同じ画面でも1画素ずつ僅かに違う。
  //   完全一致で数えたら、静止画5秒の録画が「違う絵5枚」になった（実測）。
  it("符号化の粗（わずかな差）は同じ絵と見る", () => {
    expect(sameFrame(flat(100), noisy(100, 576, PIXEL_TOLERANCE - 1))).toBe(true);
  });

  it("はっきり違えば別の絵", () => {
    expect(sameFrame(flat(100), flat(200))).toBe(false);
  });

  // ⚠️ **割合で見る**＝画面の隅が少し光る程度で「別の絵」にすると、静止画でも数が増える。
  it("ごく一部だけ違うのは同じ絵と見る", () => {
    const few = Math.floor(576 * (DIFF_RATIO / 2));
    expect(sameFrame(flat(100), noisy(100, few, 80)), "隅の小さな変化で別物にしている").toBe(true);
  });

  it("広く違えば別の絵", () => {
    const many = Math.ceil(576 * (DIFF_RATIO * 4));
    expect(sameFrame(flat(100), noisy(100, many, 80))).toBe(false);
  });

  it("長さが違えば別の絵（取り出しに失敗した回を同じと言わない）", () => {
    expect(sameFrame(flat(100), flat(100, 100))).toBe(false);
  });
});

describe("違う絵が何枚あるか", () => {
  // ⚠️ **これが捕まえたい失敗**＝窓指定で撮ると全コマ同じ絵になる（実測で 1 と出た）。
  it("全部同じなら1", () => {
    expect(distinctFrames([flat(100), flat(100), flat(100)])).toBe(1);
  });

  it("変わった数だけ数える", () => {
    expect(distinctFrames([flat(10), flat(10), flat(120), flat(120), flat(240)])).toBe(3);
  });

  // ⚠️ **連続で比べない**＝行って戻る画面（開いて閉じる）で数が増えてしまう。
  it("行って戻っても、絵の種類は増えない", () => {
    expect(distinctFrames([flat(10), flat(200), flat(10), flat(200)]), "戻った絵を新しいと数えている").toBe(2);
  });

  it("1枚も無ければ0（録れていない）", () => {
    expect(distinctFrames([])).toBe(0);
  });
});

// ⚠️ **焼いたものが押した所に出ているか**を確かめる唯一の手（#1227）。
describe("変わった所の中心", () => {
  const W = 8;
  const H = 8;
  const base = () => new Uint8Array(W * H).fill(0);

  it("変わっていなければ null（描かれていないことに気づける）", () => {
    expect(changedCenter(base(), base(), W)).toBeNull();
  });

  it("1点だけ変われば、その点", () => {
    const after = base();
    after[3 * W + 5] = 255;
    expect(changedCenter(base(), after, W)).toMatchObject({ x: 5, y: 3, count: 1 });
  });

  it("かたまりなら、その真ん中", () => {
    const after = base();
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]]) after[y * W + x] = 255;
    expect(changedCenter(base(), after, W)).toMatchObject({ x: 4.5, y: 4.5, count: 4 });
  });

  // ⚠️ **わずかな差は数えない**＝符号化の粗で中心が引っぱられる。
  it("わずかな差は数えない", () => {
    const after = base();
    after[0] = 10;
    expect(changedCenter(base(), after, W, 24)).toBeNull();
  });
});
