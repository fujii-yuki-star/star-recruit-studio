// 同じ規則の中で**同じ性質を2回宣言しない**ための門番（#1104）。
//
// ⚠️ **実際に踏んだ**（2026-09-10）＝`.panel-layout--fill` に `flex: 1 1 0` を足したが、
// **同じブロックの後ろに元の `flex: 1 1 auto` が残っていた**ので、後ろが勝って
// **直したつもりの変更が丸ごと無効**だった。検査は緑・型も lint も通り、
// **実機で見るまで誰も気づけなかった**（利用者に2往復させた）。
//
// ⚠️ **型でも lint でも守れない**＝どちらの並びも CSS として正しく、後ろが勝つのが仕様。
// だから機械で留める。
//
// ⚠️ **意図的な二重宣言（古い環境向けの控え）は「いまは無い」**＝出てきたら、
// このファイルに理由つきで除外を書く（黙って通さない）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** 走査するスタイルシート（`src` 以下すべて）。 */
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return cssFiles(p);
    return name.endsWith(".css") ? [p] : [];
  });
}

/** 注記を落とす（注記の中の `:` を宣言と数えない）。 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * 1つの規則の中で2回以上宣言されている性質を返す。
 *
 * ⚠️ **カスタムプロパティ（`--x`）は除く**＝同じ名前を条件で上書きするのは正しい使い方。
 * ⚠️ **`{}` を含まない中身だけを見る**＝入れ子（`@media` の中の規則）は、内側の規則として別に当たる。
 */
export function duplicateDeclarations(css: string): { selector: string; props: string[] }[] {
  const out: { selector: string; props: string[] }[] = [];
  for (const m of stripCssComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1].trim().split("\n").pop() ?? "").trim();
    const props = m[2]
      .split(";")
      .filter((d) => d.includes(":"))
      .map((d) => d.split(":")[0].trim())
      .filter((p) => p !== "" && !p.startsWith("--"));
    const dup = [...new Set(props.filter((p) => props.filter((q) => q === p).length > 1))].sort();
    if (dup.length > 0) out.push({ selector, props: dup });
  }
  return out;
}

describe("同じ性質を2回宣言しない（#1104）", () => {
  it("どのスタイルシートにも二重宣言が無い", () => {
    const found = cssFiles(join(process.cwd(), "src")).flatMap((p) =>
      duplicateDeclarations(readFileSync(p, "utf8")).map((d) => `${p} ${d.selector} → ${d.props.join(", ")}`),
    );
    // ⚠️ **後ろが勝つので、前の宣言は「書いたのに効かない」**＝直したつもりの変更が無効になる。
    expect(found).toEqual([]);
  });
});

describe("門番自身の検査（わざと壊した入力）", () => {
  it("同じ性質が2回あれば見つける", () => {
    expect(duplicateDeclarations(".a { flex: 1 1 0; height: auto; flex: 1 1 auto; }")).toEqual([
      { selector: ".a", props: ["flex"] },
    ]);
  });

  it("別々の規則にある同じ性質は数えない", () => {
    expect(duplicateDeclarations(".a { flex: 1; }\n.b { flex: 2; }")).toEqual([]);
  });

  it("注記の中の `:` を宣言と取り違えない", () => {
    expect(duplicateDeclarations(".a { /* flex: 1; flex: 2; */ height: 0; }")).toEqual([]);
  });

  it("カスタムプロパティの上書きは通す（条件で差し替える正しい使い方）", () => {
    expect(duplicateDeclarations(".a { --x: 1px; --x: 2px; }")).toEqual([]);
  });

  it("性質の名前だけを見る（値が違っても同じ性質なら二重）", () => {
    expect(duplicateDeclarations(".a { top: 0; top: 4px; }")[0].props).toEqual(["top"]);
  });
});
