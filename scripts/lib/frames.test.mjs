// 録画が本当に動いているかの判定（#1226・ADR-0046）。**純粋関数を直接叩く**。
//
// ⚠️ **歩く形だけにしない**＝`sampleFrames` は ffmpeg を起こすので検査から叩けない。
// 判定（`sameFrame`／`distinctFrames`）を切り出してあるので、**ここを直接叩く**
//（`CLAUDE.md` §7＝拾い方を純粋関数に切り出す）。
import { describe, expect, it } from "vitest";
import { CHANGE_TOLERANCE, DIFF_RATIO, PIXEL_TOLERANCE, SAMPLE_H, SAMPLE_W, changedBounds, changedCenter, distinctFrames, framesFromResult, sameFrame } from "./frames.mjs";

/** ⚠️ **実物と同じ大きさで測る**（PR #1234 レビュー ℹ️）＝直書きだと、定数を変えても検査は緑のまま。 */
const N = SAMPLE_W * SAMPLE_H;

/** 一様な明るさのコマ。 */
const flat = (v, n = N) => Uint8Array.from({ length: n }, () => v);

/** `n` 画素だけ `delta` ずらしたコマ（符号化の粗を真似る）。 */
const noisy = (v, count, delta, n = N) =>
  Uint8Array.from({ length: n }, (_, i) => (i < count ? v + delta : v));

describe("同じ絵かどうか", () => {
  it("まったく同じなら同じ", () => {
    expect(sameFrame(flat(100), flat(100))).toBe(true);
  });

  // ⚠️ **完全一致で見ない**＝h264 は不可逆なので、同じ画面でも1画素ずつ僅かに違う。
  //   完全一致で数えたら、静止画5秒の録画が「違う絵5枚」になった（実測）。
  it("符号化の粗（わずかな差）は同じ絵と見る", () => {
    expect(sameFrame(flat(100), noisy(100, N, PIXEL_TOLERANCE - 1))).toBe(true);
  });

  it("はっきり違えば別の絵", () => {
    expect(sameFrame(flat(100), flat(200))).toBe(false);
  });

  // ⚠️ **割合で見る**＝画面の隅が少し光る程度で「別の絵」にすると、静止画でも数が増える。
  it("ごく一部だけ違うのは同じ絵と見る", () => {
    const few = Math.floor(N * (DIFF_RATIO / 2));
    expect(sameFrame(flat(100), noisy(100, few, 80)), "隅の小さな変化で別物にしている").toBe(true);
  });

  it("広く違えば別の絵", () => {
    const many = Math.ceil(N * (DIFF_RATIO * 4));
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

// ⚠️ **取り出しの失敗を「コマ0枚」にしない**＝原因が消え、**録画そのものの失敗**として報告される。
describe("取り出した結果の受け取り", () => {
  it("うまくいけば、コマに割る", () => {
    expect(framesFromResult({ status: 0, stdout: Buffer.alloc(N * 3) }).length).toBe(3);
  });

  it("端数は捨てる（途中で切れたコマを混ぜない）", () => {
    expect(framesFromResult({ status: 0, stdout: Buffer.alloc(N * 2 + 5) }).length).toBe(2);
  });

  it("失敗したら落とす（コマ0枚にしない）", () => {
    expect(() => framesFromResult({ status: 1, stderr: "こわれた" }, "a.mp4")).toThrow(/こわれた/);
  });

  it("起こせなかったときも落とす", () => {
    expect(() => framesFromResult({ error: new Error("見つかりません") })).toThrow(/見つかりません/);
  });

  // ⚠️ **コマの大きさは渡せる**（#1227）＝焼いた結果を見るときは細かく（160×100）取り出す。
  //   ここが固定だと、**別の大きさで割って**まるで違う絵を比べることになる（気づけない）。
  it("コマの大きさを渡せる（決め打ちで割らない）", () => {
    expect(framesFromResult({ status: 0, stdout: Buffer.alloc(100 * 2) }, "a.mp4", 100).length).toBe(2);
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
    expect(changedCenter(base(), after, W, CHANGE_TOLERANCE)).toBeNull();
  });

  // ⚠️ **長さ違いを黙って通さない**（PR #1237 レビュー ℹ️）＝短いと `NaN` 比較になって
  //   数え落とし、最悪「何も描かれていない」と**誤報**する（直す先を間違える）。
  it("長さが違えば落とす（黙って数え落とさない）", () => {
    expect(() => changedCenter(base(), new Uint8Array(4), W)).toThrow(/大きさが違います/);
  });
});

// ⚠️ **独立した物差し**（PR #1237 レビュー 🟡）＝`view` は引き算で出した値なので、
// **それで描いて、それで検査する**限り、丸ごと間違っていても `✓` が出る（実測）。
// 画面いっぱいの目印を焼いて、**録画そのものから中身の矩形を測る**のがこれ。
describe("広く変わった矩形", () => {
  const W = 10;
  const H = 8;
  const base = () => new Uint8Array(W * H).fill(0);
  /** (x,y) から w×h を塗ったコマ。 */
  const box = (x0, y0, w, h) => {
    const a = base();
    for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) a[y * W + x] = 255;
    return a;
  };

  it("塗った矩形の位置と大きさを返す", () => {
    expect(changedBounds(base(), box(2, 3, 5, 4), W)).toMatchObject({ x: 2, y: 3, w: 5, h: 4 });
  });

  it("変わっていなければ null", () => {
    expect(changedBounds(base(), base(), W)).toBeNull();
  });

  // ⚠️ **1画素の外れ値で矩形を広げない**＝行・列の「何割変わったか」で見る。
  it("ぽつんと1画素だけ違っても、矩形は広がらない", () => {
    const a = box(2, 3, 5, 4);
    a[0] = 255;
    expect(changedBounds(base(), a, W), "外れ値に引きずられている").toMatchObject({ x: 2, y: 3, w: 5, h: 4 });
  });

  // ⚠️ **わずかな差は数えない**＝符号化の粗で矩形が画面いっぱいに広がる。
  it("わずかな差は数えない", () => {
    const a = base().map(() => 10);
    expect(changedBounds(base(), a, W)).toBeNull();
  });

  it("長さが違えば落とす（黙って測らない）", () => {
    expect(() => changedBounds(base(), new Uint8Array(4), W)).toThrow(/大きさが違います/);
  });
});
