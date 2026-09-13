// 「日本語で書かれた文か」を見分ける物差しが、**1か所にしか無い**ことの門番（#1128 レビュー由来 🟡）。
//
// ⚠️ **実際に3か所に並んでいた**（2026-09-14 の `/canon-check`）＝画面側の関門
// （`src/app/userFacingError.ts`）・Rust が返す文の門番（`rustUserMessageGuard.test.ts`）・
// 画面の禁止語の走査（`uiTerms.ts`）が、**同じ正規表現をそれぞれ書いて**いた。
// しかも関門の注記には「物差しは Rust 側の門番と同じ」と書いてあった＝**写しでしか保たれていない
// 主張**で、片方を狭めてももう片方は黙って通し続ける（`CLAUDE.md §6`・§2-7）。
//
// ⚠️ **「1か所へ寄せた」は数えて出す**（`CLAUDE.md §7`）＝寄せたと書くだけなら、
// 片方が残っていても書ける。ここが**実数**で留める。
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/** 物差しの本体（この文字の並びが出てくる所を探す）。 */
const MATCHER = ["ぁ-ん", "ァ-ヶ", "一-龠"].join("");

/** 物差しを書いている file（`path` は `/` 区切りの相対）。 */
export function japaneseMatcherDefs(files: { path: string; src: string }[]): string[] {
  return files.filter(({ src }) => src.includes(MATCHER)).map(({ path }) => path).sort();
}

/** `src/` 以下の TypeScript を集める。 */
function srcFiles(dir: string, root: string): { path: string; src: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return srcFiles(p, root);
    if (!/\.tsx?$/.test(e.name)) return [];
    return [{ path: relative(root, p).split(sep).join("/"), src: readFileSync(p, "utf8") }];
  });
}

describe("日本語の物差しは1か所（#1128 レビュー由来）", () => {
  it("物差しを書いているのは、画面側の関門だけ", () => {
    const root = process.cwd();
    const found = japaneseMatcherDefs(srcFiles(join(root, "src"), root));
    expect(
      found,
      "物差しを書き写した file が増えました。`src/app/userFacingError.ts` の `hasJapanese` を取り込んでください",
    ).toEqual(["src/app/userFacingError.ts"]);
  });
});

describe("門番自身の検査（わざと壊した入力）", () => {
  it("書いている file を見つける", () => {
    expect(japaneseMatcherDefs([{ path: "a.ts", src: `/[${MATCHER}]/.test(s)` }])).toEqual(["a.ts"]);
  });

  it("書いていない file は挙げない（誤検出は門番の信用を落とす）", () => {
    expect(japaneseMatcherDefs([{ path: "a.ts", src: "hasJapanese(s)" }])).toEqual([]);
  });

  it("並び順は決まっている（file が増えたときに読み比べられる）", () => {
    const two = [
      { path: "z.ts", src: MATCHER },
      { path: "a.ts", src: MATCHER },
    ];
    expect(japaneseMatcherDefs(two)).toEqual(["a.ts", "z.ts"]);
  });

  it("この門番自身は物差しを書き写していない（組み立てて持つ）", () => {
    // ⚠️ **自分が引っかからない形にしてある**＝`MATCHER` を切って持つ。
    // その組み立てが**本物と同じ**であることを、ここで確かめる。
    expect(new RegExp(`[${MATCHER}]`).test("あ")).toBe(true);
    expect(new RegExp(`[${MATCHER}]`).test("ア")).toBe(true);
    expect(new RegExp(`[${MATCHER}]`).test("漢")).toBe(true);
    expect(new RegExp(`[${MATCHER}]`).test("os error 3")).toBe(false);
  });
});
