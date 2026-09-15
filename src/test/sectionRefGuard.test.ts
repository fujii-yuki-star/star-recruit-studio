// 資料の**節を指す引用**が、実在する所を指していることの門番（#1151）。
//
// ⚠️ **実際に空振りしていた**（α 出口監査 2026-09-14）＝`06 §2` の統一規約に `8.7`〜`9.5` のような
// 小数を付けていたので、**実在する `## 8. 動画案確認画面`／`## 9. シーン編集画面` と同じ番号**になり、
// コードから引いた 06 §9.3・06 §9.0.1・06 §8.7 は**開いても無い**所を指していた
// （⚠️ **ここでバッククォートを付けない**のは、この門番自身が本物の引用と読んでしまうから）。
// 並びも `9 → 9.6 → 8.7 → 8.8 → 8.9 → 9.0 → 9.0.1 → …` と体系が無かった。
//
// ⚠️ **誰も見ていなかった**＝`aiWorkGuideLinks` は `docs/ai_work_guides/` しか走査しない。
// ⚠️ **番号を振り直しただけでは、また起きる**＝次に足す人が小数を付けたら同じことになるので、
// **機械で見る**（`06 §2` は「規約N」＝この節だけの連番、と資料にも書いた）。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sectionsOf } from "./aiWorkGuideLinks.test";

const ROOT = process.cwd();
const DOCS = "docs/yuko_recruit_docs";

/** 引用の指し先（`06` なら `06_UI_SPEC.md`）。⚠️ **ここに無い資料は見ない**（誤検出を作らない）。 */
const CANON: Record<string, string> = {
  "04": `${DOCS}/04_TEMPLATE_SPEC.md`,
  "05": `${DOCS}/05_RENDERING_SPEC.md`,
  "06": `${DOCS}/06_UI_SPEC.md`,
  "15": `${DOCS}/15_ERROR_STATE_MODEL.md`,
};

/**
 * 本文から拾った「`NN §x.y`」の引用（`{ doc, section }` の並び）。
 *
 * ⚠️ **`§2 規約N` は節ではない**＝この節だけの連番なので、節の一覧には出ない。拾わない。
 * ⚠️ **コメントの中も見る**＝引用はほとんどコメントに書かれる（そこが空振りすると、
 * 次に読む人が「無い節」を探しに行く）。
 */
export function sectionCitations(text: string): { doc: string; section: string }[] {
  const out: { doc: string; section: string }[] = [];
  for (const m of text.matchAll(/`(\d{2}) §(\d+(?:\.\d+)*)`/g)) {
    const [, doc, section] = m;
    // 規約の連番（`06 §2` 規約N）は節ではないので、`§2` 単体は素通しでよい（節としても実在する）。
    out.push({ doc: doc!, section: section! });
  }
  return out;
}

/** 指し先が無い引用（`file: 06 §9.3` の形で返す）。 */
export function danglingRefs(
  files: { path: string; src: string }[],
  sections: (doc: string) => Set<string> | undefined,
): string[] {
  return files.flatMap(({ path, src }) =>
    sectionCitations(src)
      .filter(({ doc, section }) => {
        const known = sections(doc);
        return known !== undefined && !known.has(section);
      })
      .map(({ doc, section }) => `${path}: ${doc} §${section}`),
  );
}

function walk(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(rel, keep);
    return keep(e.name) ? [rel] : [];
  });
}

/**
 * `06 §2` の規約の番号（行頭の `N.`）。
 *
 * ⚠️ **ここが小数になると、`## 8.`／`## 9.` の節番号と衝突する**（#1151 で実際にそうなっていた）。
 * 番号を直すだけでは**次に足す人がまた小数を付ける**ので、**形そのもの**を留める。
 */
export function conventionNumbers(six: string): string[] {
  const lines = six.split("\n");
  const start = lines.findIndex((l) => l.startsWith("## 2. "));
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## 3. "));
  return lines
    .slice(start, end)
    .map((l) => /^(\d+(?:\.\d+)*)\. \*\*/.exec(l)?.[1])
    .filter((n): n is string => n !== undefined);
}

/** 走査する所＝コード（`src/**`）と資料（`docs/**`）と `CLAUDE.md`。 */
function scanned(): { path: string; src: string }[] {
  const paths = [
    ...walk("src", (n) => /\.tsx?$/.test(n)),
    ...walk("docs", (n) => n.endsWith(".md")),
    "CLAUDE.md",
  ];
  return paths.map((p) => ({ path: p, src: readFileSync(join(ROOT, p), "utf8") }));
}

const sectionsFor = (doc: string): Set<string> | undefined => {
  const path = CANON[doc];
  return path ? sectionsOf(readFileSync(join(ROOT, path), "utf8")) : undefined;
};

describe("節を指す引用が、実在する所を指している（#1151）", () => {
  it("指し先の無い引用が無い", () => {
    expect(
      danglingRefs(scanned(), sectionsFor),
      "実在しない節を指しています。**番号を確かめて直してください**（`06 §2` の規約は「規約N」と書く＝#1151）",
    ).toEqual([]);
  });

  // ⚠️ **番号を直すだけでは、また起きる**（#1151 の変異チェックで生き残った）＝
  // 次に足す人が小数を付けたら、また `## 8.`／`## 9.` と衝突する。**形そのもの**を留める。
  it("`06 §2` の規約は、小数の無い連番（節番号と衝突させない）", () => {
    const nums = conventionNumbers(readFileSync(join(ROOT, CANON["06"]!), "utf8"));
    expect(nums.length, "規約を1つも拾えていません").toBeGreaterThan(20);
    expect(
      nums.filter((n) => n.includes(".")),
      "規約に小数の番号があります＝`## 8.`／`## 9.` の節番号と衝突します（#1151）",
    ).toEqual([]);
    expect(
      nums,
      "規約の番号が 1 から続く連番になっていません（飛びや重なりは、引用の指し先を壊します）",
    ).toEqual(nums.map((_, i) => String(i + 1)));
  });

  // ⚠️ **走査が空振りしていない**＝1件も拾えていなければ、何を壊しても緑になる。
  it("走査が引用を拾えている（空振りしていない）", () => {
    const files = scanned();
    expect(files.length, "走査の根が変わりました").toBeGreaterThan(400);
    // ⚠️ **資料も歩いていること**（変異チェックで生き残った）＝`src` だけでも数は足りてしまうので、
    // **資料と `CLAUDE.md` が入っていること**を名指しで留める（引用は資料どうしにも多い）。
    for (const must of ["docs/yuko_recruit_docs/06_UI_SPEC.md", "CLAUDE.md"]) {
      expect(files.some((f) => f.path === must), `${must} を歩けていません`).toBe(true);
    }
    const found = files.flatMap(({ src }) => sectionCitations(src));
    expect(found.length, "引用を1つも拾えていません").toBeGreaterThan(50);
    // 見ている資料の数も留める（`CANON` を空にすると、何を指しても緑になる）。
    expect(Object.keys(CANON)).toHaveLength(4);
  });

  // ⚠️ **拾い方そのものを叩く**＝歩く形だけだと「いまの資料に空振りが無いので緑」になる。
  describe("拾い方の検査", () => {
    const known = (doc: string): Set<string> | undefined =>
      doc === "06" ? new Set(["2", "12", "12.1"]) : undefined;

    it("実在しない節を見つける", () => {
      const bad = ["`06 §9", ".3`"].join(""); // ⚠️ **綴りを割る**＝上の走査が自分の検査を拾わない
      expect(danglingRefs([{ path: "a.ts", src: `見よ ${bad} を` }], known)).toEqual(["a.ts: 06 §9.3"]);
    });

    it("実在する節は通す", () => {
      expect(danglingRefs([{ path: "a.ts", src: "`06 §12.1` と `06 §2`" }], known)).toEqual([]);
    });

    // ⚠️ **知らない資料は見ない**＝誤検出は門番の信用を落とす（`12 §8.3` などは対象外）。
    it("知らない資料の引用は見ない", () => {
      expect(danglingRefs([{ path: "a.ts", src: "`12 §8.3`" }], known)).toEqual([]);
    });

    // ⚠️ **規約の連番は節ではない**＝`06 §2` 規約20 の「20」を節として探しに行かない。
    it("規約の連番を節として拾わない", () => {
      expect(sectionCitations("`06 §2` 規約20")).toEqual([{ doc: "06", section: "2" }]);
    });

    it("規約の番号の拾い方（小数と飛びを見つけられる形）", () => {
      const doc = (body: string): string => `## 2. UI基本方針\n${body}\n## 3. 用語\n`;
      expect(conventionNumbers(doc("1. **あ**\n2. **い**"))).toEqual(["1", "2"]);
      expect(conventionNumbers(doc("1. **あ**\n9.3. **い**"))).toEqual(["1", "9.3"]);
      // ⚠️ **太字で始まらない箇条書きは規約ではない**（誤検出を作らない）。
      expect(conventionNumbers(doc("1. ふつうの箇条書き"))).toEqual([]);
      // ⚠️ **§2 の外は見ない**＝他の節の箇条書きを規約と数えない。
      expect(conventionNumbers("## 1. 目的\n1. **これは規約ではない**\n## 2. UI基本方針\n1. **あ**\n## 3. 用語\n")).toEqual(["1"]);
    });
  });
});
