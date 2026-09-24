// 撮影の引数と台本の読み取り（#1226・PR #1234 レビュー 🟡）。
import { describe, expect, it } from "vitest";
import { checkPlan, parseOutDir } from "./plan.mjs";

describe("出力先の読み取り", () => {
  it("`--out` があればそれを使う", () => {
    expect(parseOutDir(["--out", "foo"])).toBe("foo");
  });

  it("無ければ既定", () => {
    expect(parseOutDir([])).toBe("tutorial-out");
  });

  // ⚠️ **印の無い引数を出力先にしない**（変異チェックで生き残った）＝`[]` だけで見ていると、
  //   `rest[0]` を返す実装でも**緑になる**（そこが元の穴だった）。
  it("印の無い引数は出力先にしない", () => {
    expect(parseOutDir(["nanika"]), "第1引数を出力先にしている").toBe("tutorial-out");
  });

  // ⚠️ **これが元の穴**＝`… plan.json --dry` が `--dry` という名前のフォルダを作っていた。
  it("知らない印は断る（黙って別の所へ書かない）", () => {
    expect(() => parseOutDir(["--dry"])).toThrow(/知らない印/);
  });

  it("`--out` のあとが空なら断る", () => {
    expect(() => parseOutDir(["--out"])).toThrow(/出力フォルダがありません/);
  });

  it("`--out` の値が印に見えても、値として受ける", () => {
    expect(parseOutDir(["--out", "--strange"])).toBe("--strange");
  });
});

describe("台本の読み取り", () => {
  it("正しい台本は通る", () => {
    expect(() => checkPlan({ steps: [{ clickText: "押す" }, { waitMs: 100 }] })).not.toThrow();
  });

  // ⚠️ **これが元の穴**＝打ち間違いが無言で消え、短いままの録画に `✓` が出ていた。
  it("`clickText` の打ち間違いを断る", () => {
    expect(() => checkPlan({ steps: [{ clickTest: "押す" }] })).toThrow(/1 段目/);
  });

  it("何段目かを言う（どこを直せばよいか分かる）", () => {
    expect(() => checkPlan({ steps: [{ clickText: "a" }, { clickText: "b" }, { nope: 1 }] })).toThrow(/3 段目/);
  });

  it("`steps` が無い／配列でないなら断る", () => {
    expect(() => checkPlan({})).toThrow(/steps/);
    expect(() => checkPlan({ steps: "押す" })).toThrow(/steps/);
  });

  it("段が0なら断る（録っても何も起きない）", () => {
    expect(() => checkPlan({ steps: [] })).toThrow(/段が1つもありません/);
  });

  it("`waitMs` が数でなければ断る", () => {
    expect(() => checkPlan({ steps: [{ waitMs: "500" }] })).toThrow(/数ではありません/);
  });
});
