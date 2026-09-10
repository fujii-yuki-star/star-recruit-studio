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
import { basename, join } from "node:path";
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

/** 注記と波かっこの釣り合い（開いたまま閉じていないものを見つける）。 */
export function unbalanced(css: string): { openComments: number; braces: number } {
  let i = 0;
  let openComments = 0;
  while (i < css.length - 1) {
    const two = css.slice(i, i + 2);
    if (two === "/*") { openComments += 1; i += 2; continue; }
    if (two === "*/") { openComments -= 1; i += 2; continue; }
    i += 1;
  }
  const body = stripCssComments(css);
  const braces = (body.match(/\{/g) ?? []).length - (body.match(/\}/g) ?? []).length;
  return { openComments, braces };
}

describe("スタイルシートが壊れていない（#1104）", () => {
  // ⚠️ **実際に壊した**（2026-09-10）＝置換のときに注記の閉じ（`*/`）を一緒に消してしまい、
  // **そこから約 150 行の CSS が丸ごと注記として無効**になった。
  // 画面は崩れるが、**型も lint も検査も全部緑**で、利用者のスクリーンショット2往復ぶん気づけなかった。
  // ⚠️ **1文字の欠けが、遠くの規則を静かに殺す**＝機械で見るしかない。
  it("注記と波かっこが釣り合っている", () => {
    const broken = cssFiles(join(process.cwd(), "src")).flatMap((p) => {
      const u = unbalanced(readFileSync(p, "utf8"));
      return u.openComments !== 0 || u.braces !== 0
        ? [`${p} 注記の開き残り=${u.openComments} 波かっこの差=${u.braces}`]
        : [];
    });
    expect(broken).toEqual([]);
  });
});

/**
 * 注記を落としたあとに残っている**宣言の数**（`性質: 値;` の数）。
 *
 * ⚠️ **釣り合いだけでは呑み込みを見つけられない**（レビュー由来 🟡）＝`unbalanced()` は
 * 注記の**開きと閉じの総数の差**しか見ないので、**別々の注記の開きと閉じを1回の編集で壊す**と
 * 差し引きゼロになって素通りする（そして間の規則は丸ごと注記に呑まれて消える＝今回の事故の亜種）。
 * ⚠️ **呑まれれば宣言は必ず減る**ので、数で留めれば釣り合いに関係なく気づける。
 */
export function declarationCount(css: string): number {
  return stripCssComments(css).split(";").filter((d) => d.includes(":")).length;
}

/**
 * 各スタイルシートが持つ宣言の数の**下限**（実測 2026-09-10）。
 *
 * ⚠️ **下限にする**＝足すたびに数を直させない（そこは差分で見える）。**減るとき**だけ立ち止まる。
 * ⚠️ **規則をわざと消したら、この数も一緒に下げる**（下げた事実が差分に残るのが狙い）。
 */
const MIN_DECLARATIONS: Record<string, number> = {
  "timeline.css": 223,
  "fonts.css": 20,
  "theme.css": 809,
};

describe("注記が規則を呑み込んでいない（#1104）", () => {
  it("宣言の数が、記録した下限を割っていない", () => {
    const shrunk = cssFiles(join(process.cwd(), "src")).flatMap((p) => {
      const name = basename(p);
      const min = MIN_DECLARATIONS[name];
      if (min == null) return [`${name} の下限が記録されていない（足したら数も記録する）`];
      const now = declarationCount(readFileSync(p, "utf8"));
      return now < min ? [`${name} 宣言が ${min} → ${now} に減っている`] : [];
    });
    expect(shrunk).toEqual([]);
  });

  it("記録した下限が、実態からかけ離れていない（下げて無効化しない）", () => {
    // ⚠️ **下限は下げれば無力化できる**（変異チェックで露見）＝`0` にしておけば、
    // 規則が丸ごと呑まれても通ってしまう。下限は「**いまの数の少し下**」であるべきなので、
    // その関係も機械で見る（1割以上増えたら、下限も上げ直すことになる＝そこで一度目を通す）。
    const off = cssFiles(join(process.cwd(), "src")).flatMap((p) => {
      const name = basename(p);
      const min = MIN_DECLARATIONS[name];
      if (min == null) return [];
      const now = declarationCount(readFileSync(p, "utf8"));
      return min < Math.floor(now * 0.9) ? [`${name} 下限 ${min} が実態 ${now} より低すぎる`] : [];
    });
    expect(off).toEqual([]);
  });
});

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

  it("閉じていない注記を見つける（門番自身の検査）", () => {
    expect(unbalanced("/* 開きっぱなし\n.a { top: 0; }").openComments).toBe(1);
    expect(unbalanced("/* ふつう */\n.a { top: 0; }").openComments).toBe(0);
  });

  it("宣言の数を数える（注記の中は数えない）", () => {
    expect(declarationCount(".a { top: 0; left: 1px; }")).toBe(2);
    expect(declarationCount(".a { /* top: 0; */ left: 1px; }")).toBe(1);
  });

  it("**釣り合ったまま呑み込む**壊し方を、数で見つける（釣り合いでは見つからない）", () => {
    // ⚠️ **レビューで挙がった穴**＝注記Aの閉じと注記Bの開きを同時に消すと、`/*` と `*/` の数は
    // 1つずつ減って**釣り合いは崩れない**のに、間の規則は注記に呑まれて消える。
    const before = "/* A */\n.sel1 { color: red; }\n/* B */\n.sel2 { color: blue; }\n";
    const after = "/* A\n.sel1 { color: red; }\n B */\n.sel2 { color: blue; }\n";
    expect(unbalanced(after)).toEqual(unbalanced(before)); // 釣り合いでは差が出ない
    expect(declarationCount(after)).toBeLessThan(declarationCount(before)); // 数なら出る
  });

  it("釣り合わない波かっこを見つける（門番自身の検査）", () => {
    expect(unbalanced(".a { top: 0;").braces).toBe(1);
    expect(unbalanced(".a { top: 0; }").braces).toBe(0);
  });

});
