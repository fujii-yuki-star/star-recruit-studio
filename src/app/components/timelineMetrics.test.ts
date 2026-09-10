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
// ⚠️ **拾い方は1か所**（`src/test/cssRules.ts`）＝同じ取り出しを `PanelLayoutView.test.tsx` も使う。
import { ruleBody } from "../../test/cssRules";

const css = readFileSync(join(process.cwd(), "src/app/components/timeline.css"), "utf8");

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

describe("「並び」は道具立てを留めて帯だけ流す（#1104）", () => {
  // ⚠️ **実機で測って直した**（2026-09-10・`tools/uiProbe.mjs`）＝列を12本にすると、
  // 欄ごと縦に流れるので**「列を足す」が画面の外へ出て列を足せなくなり**、しかも
  // 帯は欄の下端で**切り落とされて**いた（どこもスクロールしないまま消える）。
  // ⚠️ **jsdom は高さを計算しない**ので、ここで見られるのは「どこが流す役か」という**書き方**だけ。
  // 実寸の確認は `tools/uiProbe.mjs`（PR 本文に測定値）。
  it("帯の枠が縦にも流す（`overflow-y: hidden` に戻さない）", () => {
    const scroll = ruleBody(css, ".timeline-scroll");
    expect(scroll).not.toBeNull();
    expect(/overflow-y:\s*auto\s*;/.test(scroll ?? "")).toBe(true);
  });

  it("並びの中身は縦に積み、帯の枠だけが伸び縮みする", () => {
    const panel = ruleBody(css, ".timeline-panel");
    expect(panel).not.toBeNull();
    expect(panel).toContain("flex-direction: column");
    // ⚠️ **`min-height: 0` が要る**＝無いと中身なりの高さより縮まず、器を越えた分が外へ出る。
    expect(/min-height:\s*0\s*;/.test(panel ?? "")).toBe(true);
    const inner = ruleBody(css, ".timeline-panel > .timeline > .timeline-scroll");
    expect(inner).not.toBeNull();
    expect(/flex:\s*1 1 0\s*;/.test(inner ?? "")).toBe(true);
    expect(/min-height:\s*0\s*;/.test(inner ?? "")).toBe(true);
  });

  it("添え書きと「列を足す」は縮まない（帯だけが伸び縮みする）", () => {
    const kids = ruleBody(css, ".timeline-panel > *");
    expect(kids).not.toBeNull();
    expect(/flex:\s*0 0 auto\s*;/.test(kids ?? "")).toBe(true);
  });
});

describe("列の名前の欄と目盛り（#1104 レビュー由来）", () => {
  it("名前は伸び縮みして、添え書きと「⋮」は縮まない", () => {
    // ⚠️ **実機で名前が幅 0 まで潰れていた**（2026-09-10 実測）＝横並びにしたとき、
    // 縮むのが名前だけだと「出さない 固定中 ⋮」しか残らず、**どの列か分からなくなる**。
    // 守ったのは欄の幅（`TIMELINE_LABEL_W_PX` 84 → 124）だが、
    // **伸び縮みの向き**（名前が伸びる・添え書きは縮まない）も戻されないように留める。
    const name = ruleBody(css, ".timeline-row-label > span:first-child");
    expect(name).not.toBeNull();
    expect(/flex:\s*1 1 auto\s*;/.test(name ?? "")).toBe(true);
    expect(/text-overflow:\s*ellipsis\s*;/.test(name ?? "")).toBe(true);
    const sub = ruleBody(css, ".timeline-row-label .sub");
    expect(/flex:\s*0 0 auto\s*;/.test(sub ?? "")).toBe(true);
    const menu = ruleBody(css, ".timeline-row-menu");
    expect(/flex:\s*0 0 auto\s*;/.test(menu ?? "")).toBe(true);
  });

  it("目盛りの行は貼り付く（列を送っても残る）", () => {
    // ⚠️ **縦に流れる箱を帯の枠へ移した副作用**（レビュー由来 ℹ️）＝列が増えて下へ送ると
    // 目盛りも一緒に流れて消え、「いま何秒の所を見ているか」が分からなくなる。
    // 一般的な動画編集ソフトでは**ルーラーは残る**（ADR-0034＝業界の型に合わせる）。
    const ruler = ruleBody(css, ".timeline-panel .timeline-inner > .timeline-row:first-child");
    expect(ruler).not.toBeNull();
    expect(/position:\s*sticky\s*;/.test(ruler ?? "")).toBe(true);
    expect(/top:\s*0\s*;/.test(ruler ?? "")).toBe(true);
    // ⚠️ **下地を敷く**＝敷かないと、下から来た帯が目盛りの文字に透ける。
    expect(ruler).toContain("background:");
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

  it("規則は行頭で当てる（末尾が同じ綴りの規則に先を越されない）", () => {
    // ⚠️ 実際にこの綴りを足した＝`.timeline-panel > .timeline > .timeline-scroll` が
    // `.timeline-scroll` の探しものに先に当たると、**別の規則の中身を見て通ってしまう**。
    const src = ".a > .b {\n  height: 1px;\n}\n.b {\n  height: 2px;\n}\n";
    expect(ruleBody(src, ".b")).toContain("2px");
    expect(ruleBody(src, ".b")).not.toContain("1px");
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
