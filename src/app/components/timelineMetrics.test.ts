// タイムラインの寸法が**1か所から導かれている**ことの門番（#1104）。
//
// ⚠️ **幅には正があるのに、高さは CSS だけに書いてあった**＝行の高さ（`.timeline-lane`）・
// 帯の上下の余白と行内の文字（`.timeline-clip`）・帯の中の「⋮」が、**別々の数字**で書かれていた。
// この形だと **#1104 ②（行を詰める）で片方だけ変えたときに、帯が行からはみ出す**。
//
// ⚠️ **jsdom は CSS ファイルを読まない**ので、描いて確かめることはできない＝
// **CSS の書き方そのもの**を見る（既存の `--clip-menu-w` の階級を見る検査と同じ流儀・#752）。
//
// ⚠️ **「歩くだけ」にしない**＝取り出し（どのブロックの中身か）を純粋関数に出し、
// 下の「門番自身の検査」でわざと壊した入力を通す。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TIMELINE_CLIP_INSET_PX, TIMELINE_LANE_H_PX } from "../../domain/constants";

const css = readFileSync(join(process.cwd(), "src/app/components/timeline.css"), "utf8");

/**
 * 規則の中身（`{` から `}` まで）を取り出す。無ければ `null`。
 *
 * ⚠️ **`null` を返す**＝規則ごと消えたときに「中身が空だから通った」にしない（見落とす側に倒れる）。
 */
export function ruleBody(source: string, selector: string): string | null {
  const head = `${selector} {`;
  const at = source.indexOf(head);
  if (at < 0) return null;
  const end = source.indexOf("}", at);
  if (end < 0) return null;
  return source.slice(at + head.length, end);
}

/**
 * その規則が、その変数を**宣言している**か（`var(--x)` で使っているだけ、と区別する）。
 *
 * ⚠️ **「名前が本文に在る」では足りない**（変異チェックで生き残った）＝導出の `calc` が
 * `var(--timeline-clip-border-w)` と書いているので、**宣言を消しても名前は本文に残る**。
 * 宣言だけが持つ「名前のすぐ後ろのコロン」を見る。
 */
export function declares(body: string, name: string): boolean {
  return new RegExp(String.raw`(^|;|\n)\s*${name}\s*:`).test(body);
}

/** その規則が、数字を直書きしている宣言を持っているか（`height: 40px` のような形）。 */
export function hardCodesPx(body: string, prop: string): boolean {
  return new RegExp(String.raw`(^|;|\n)\s*${prop}\s*:\s*[-\d.]+px\s*(;|$)`).test(body);
}

describe("タイムラインの寸法は1か所から導く（#1104）", () => {
  it("行の高さ・帯の余白・行内の文字の高さは、`.timeline` が宣言する", () => {
    // ⚠️ **`.timeline` で宣言する**＝行・帯・「⋮」の**すべてから**見える必要がある
    //（カスタムプロパティは子孫にしか継承しない＝帯で宣言すると「⋮」に届かない・#701 の再発）。
    const root = ruleBody(css, ".timeline");
    expect(root).not.toBeNull();
    expect(declares(root ?? "", "--timeline-lane-h")).toBe(true);
    expect(declares(root ?? "", "--timeline-clip-inset")).toBe(true);
    expect(declares(root ?? "", "--timeline-clip-line-h")).toBe(true);
  });

  it("行内の文字の高さは、行の高さと余白から導く（3つ目の数字を増やさない）", () => {
    const root = ruleBody(css, ".timeline") ?? "";
    const line = /--timeline-clip-line-h:([^;]+);/.exec(root)?.[1] ?? "";
    expect(line).toContain("var(--timeline-lane-h)");
    expect(line).toContain("var(--timeline-clip-inset)");
  });

  it("行は、高さを直書きしない", () => {
    const lane = ruleBody(css, ".timeline-lane");
    expect(lane).not.toBeNull();
    expect(hardCodesPx(lane ?? "", "height")).toBe(false);
    expect(lane).toContain("var(--timeline-lane-h)");
  });

  it("帯は、上下の余白と文字の高さを直書きしない", () => {
    const clip = ruleBody(css, ".timeline-clip");
    expect(clip).not.toBeNull();
    expect(hardCodesPx(clip ?? "", "top")).toBe(false);
    expect(hardCodesPx(clip ?? "", "bottom")).toBe(false);
    expect(hardCodesPx(clip ?? "", "line-height")).toBe(false);
  });

  it("帯の中の「⋮」も、同じ余白と同じ文字の高さを使う（帯だけ詰めても取り残されない）", () => {
    // ⚠️ **「⋮」は帯の兄弟で、包含ブロックも同じ**（`.timeline-lane`）＝上下の余白は帯とまったく同じ値。
    // ここが直書きのまま残ると、余白を詰めたとき**箱より文字が高くなって帯とも上下がずれる**
    // （レビュー 🔴＝最初は `line-height` しか見ておらず、この2つを**構造的に見つけられなかった**）。
    const menu = ruleBody(css, ".timeline-clip-menu");
    expect(menu).not.toBeNull();
    expect(hardCodesPx(menu ?? "", "top")).toBe(false);
    expect(hardCodesPx(menu ?? "", "bottom")).toBe(false);
    expect(hardCodesPx(menu ?? "", "line-height")).toBe(false);
    expect(menu).toContain("var(--timeline-clip-inset)");
    expect(menu).toContain("var(--timeline-clip-line-h)");
  });

  it("CSS の既定は TS の値と一致する（片方だけ変えて黙ってずれない）", () => {
    // ⚠️ 流し込みは必ず行われるので既定は普通は使われないが、**書き写しである以上ずれ得る**
    //（`--timeline-label-w` と同じ流儀・#752 レビュー）。CSS に「単一の参照元は TS」と書いた以上、
    // 一致を見る検査が無いと**その主張が成り立たないまま**になる（レビュー 🟡）。
    const root = ruleBody(css, ".timeline") ?? "";
    const decl = (name: string): string | undefined =>
      new RegExp(`${name}:([^;]+);`).exec(root)?.[1].trim();
    expect(decl("--timeline-lane-h")).toBe(`${TIMELINE_LANE_H_PX}px`);
    expect(decl("--timeline-clip-inset")).toBe(`${TIMELINE_CLIP_INSET_PX}px`);
  });

  it("帯の枠線の太さも1か所から引く（文字の高さの計算と食い違わせない）", () => {
    // ⚠️ **`calc` の中の `2px` は新しい直書きだった**（レビュー 🟡）＝枠線を太くしたときに、
    // 文字の高さだけ古い前提のまま残る。
    const root = ruleBody(css, ".timeline") ?? "";
    expect(declares(root, "--timeline-clip-border-w")).toBe(true);
    const line = /--timeline-clip-line-h:([^;]+);/.exec(root)?.[1] ?? "";
    expect(line).toContain("var(--timeline-clip-border-w)");
    const clip = ruleBody(css, ".timeline-clip") ?? "";
    expect(hardCodesPx(clip, "border")).toBe(false);
    expect(clip).toContain("var(--timeline-clip-border-w)");
  });
});

describe("帯の密度（#1104・実機の指摘）", () => {
  // ⚠️ **実機の報告から直した**（2026-09-10）＝「明らかに帯一つ一つの間の空間が今は広すぎます。
  // 普通の動画エディターツールでももっとぎちぎちだと思います」。
  it("列の高さと帯の余白を、実数で留める", () => {
    // ⚠️ **相対で書かない**＝「前より小さい」では、戻されたときに気づけない。
    expect(TIMELINE_LANE_H_PX).toBe(28);
    expect(TIMELINE_CLIP_INSET_PX).toBe(2);
  });

  it("列の名前の欄は、行間を詰めてある（詰めないと列の高さがそれに引きずられる）", () => {
    // ⚠️ **これが 40px だった理由**＝`:root` の `line-height: 1.6` を継ぐと、
    // 名前(12px)＋添え(10px)で 35.2px 要り、列はそれ以上でないと収まらなかった。
    const label = ruleBody(css, ".timeline-row-label");
    expect(label).not.toBeNull();
    const lh = Number(/line-height:\s*([\d.]+)\s*;/.exec(label ?? "")?.[1]);
    expect(Number.isFinite(lh)).toBe(true);
    // 名前と添えの2行が、列の高さに収まること（これが崩れると文字が行からはみ出す）。
    expect(12 * lh + 10 * lh).toBeLessThanOrEqual(TIMELINE_LANE_H_PX);
  });
});

describe("門番自身の検査（わざと壊した入力）", () => {
  it("規則が無ければ null（中身が空だから通った、にしない）", () => {
    expect(ruleBody(".other { a: 1px; }", ".timeline-lane")).toBeNull();
  });

  it("規則の中身だけを取り出す（次の規則を巻き込まない）", () => {
    const src = ".a {\n  height: 1px;\n}\n.b {\n  height: 2px;\n}\n";
    expect(ruleBody(src, ".a")).toContain("1px");
    expect(ruleBody(src, ".a")).not.toContain("2px");
  });

  it("宣言と、使っているだけを見分ける", () => {
    // ⚠️ ここが緩いと、**宣言を消しても `var()` で名前が残っているから通る**（実際に生き残った）。
    expect(declares("\n  --a: 1px;\n", "--a")).toBe(true);
    expect(declares("\n  height: var(--a);\n", "--a")).toBe(false);
    // 似た名前を巻き込まない。
    expect(declares("\n  --ab: 1px;\n", "--a")).toBe(false);
  });

  it("数字の直書きを見つける", () => {
    expect(hardCodesPx("\n  height: 40px;\n", "height")).toBe(true);
    expect(hardCodesPx("\n  height: var(--x);\n", "height")).toBe(false);
  });

  it("よく似た別の宣言を、直書きと取り違えない", () => {
    // ⚠️ `line-height` を見ているのに `height` の直書きで赤くならない（誤検出は門番の信用を落とす）。
    expect(hardCodesPx("\n  height: 40px;\n  line-height: var(--x);\n", "line-height")).toBe(false);
    expect(hardCodesPx("\n  min-width: 2px;\n", "width")).toBe(false);
  });
});
