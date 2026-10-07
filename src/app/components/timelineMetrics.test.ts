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

/**
 * その規則の宣言を**数として**取り出す（`font-size: 12px` → `12`）。
 *
 * ⚠️ **検査側に書き写さない**（#1122）＝以前ここは `12 * lh + 10 * lh` と**数字を書いて**いた。
 * CSS の `font-size` だけ変えても門番は**古い数字のまま通る**＝「行の高さに収まる」という主張が、
 * 実際には守られていない状態になりえた（`CLAUDE.md §7`「作った門番自体に穴が空く」）。
 * ⚠️ **どちらを先に決めるかは固定しない**＝字の大きさから導くのでも、行の高さから導くのでもなく、
 * **いまの値どうしが収まっているか**だけを見る（案 A・向きは決めない）。
 */
export function pxOf(body: string | null, prop: string): number {
  const m = new RegExp(String.raw`(^|;|\n)\s*${prop}\s*:\s*([-\d.]+)px\s*(;|$)`).exec(body ?? "");
  return m ? Number(m[2]) : NaN;
}

/** その規則が宣言している `line-height`（単位なしの倍率）。無ければ `NaN`。 */
export function lineHeightOf(body: string | null): number {
  const m = /(^|;|\n)\s*line-height:\s*([\d.]+)\s*(;|$)/.exec(body ?? "");
  return m ? Number(m[2]) : NaN;
}

/**
 * **欄に並ぶもの1つぶんの高さ**（字の大きさ × 行間）。
 *
 * ⚠️ **行間は自分のものを優先する**（PR #1132 レビュー由来 🟡）＝「⋮」は `line-height: 1` を
 * 自分で宣言しているので、欄の 1.15 を掛けると**実際より高く見積もる**。
 * 宣言が無いものは欄の値を継ぐ。
 */
export function lineBoxPx(body: string | null, fallbackLh: number): number {
  const own = lineHeightOf(body);
  return pxOf(body, "font-size") * (Number.isFinite(own) ? own : fallbackLh);
}

describe("取り出しそのものの検査（わざと壊した入力）", () => {
  it("数として取り出す（単位を落とす）", () => {
    expect(pxOf("font-size: 12px;", "font-size")).toBe(12);
    expect(pxOf("  font-size:10px ;", "font-size")).toBe(10);
    expect(pxOf("line-height: 1.15;\n  font-size: 14px;", "font-size")).toBe(14);
  });

  it("無ければ数にならない（0 を返して黙って通さない）", () => {
    expect(Number.isNaN(pxOf("color: red;", "font-size"))).toBe(true);
    expect(Number.isNaN(pxOf(null, "font-size"))).toBe(true);
    // ⚠️ **`px` でない値は取らない**＝`font-size: 1.2rem` を 1.2px として扱わない。
    expect(Number.isNaN(pxOf("font-size: 1.2rem;", "font-size"))).toBe(true);
  });

  it("別の宣言を巻き込まない（名前の前を見る）", () => {
    // `font-size` を探して `-webkit-font-size` のような別名まで拾わない。
    expect(Number.isNaN(pxOf("-x-font-size: 99px;", "font-size"))).toBe(true);
  });

  it("行間は自分のものを優先し、無ければ継ぐ", () => {
    // ⚠️ **「⋮」は自分で `line-height: 1` を宣言している**＝欄の 1.15 を掛けると高く見積もる。
    expect(lineBoxPx("font-size: 14px; line-height: 1;", 1.15)).toBe(14);
    expect(lineBoxPx("font-size: 10px;", 1.15)).toBeCloseTo(11.5, 5);
    expect(lineHeightOf("font-size: 14px; line-height: 1;")).toBe(1);
    expect(Number.isNaN(lineHeightOf("font-size: 10px;"))).toBe(true);
  });

  it("読めないものは高さにならない（0 で黙って通さない）", () => {
    expect(Number.isNaN(lineBoxPx("color: red;", 1.15))).toBe(true);
    expect(Number.isNaN(lineBoxPx(null, 1.15))).toBe(true);
  });
});

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
    // 名前(12px)＋添え(10px)を**縦に積んで** 35.2px 要り、列はそれ以上でないと収まらなかった。
    const label = ruleBody(css, ".timeline-row-label");
    expect(label).not.toBeNull();
    const lh = Number(/line-height:\s*([\d.]+)\s*;/.exec(label ?? "")?.[1]);
    expect(Number.isFinite(lh)).toBe(true);

    // ⚠️ **字の大きさは CSS から読む**（#1122）＝検査側に書き写すと、CSS だけ変えたときに
    // **古い数字のまま通る**。
    // ⚠️ **欄に並ぶものを全部数える**（PR #1132 レビュー由来 🟡）＝最初は名前と添えだけを見ていたが、
    // **いま列の高さを決めているのは「⋮」**（14px × 行間1 = 14px＞名前 13.8px＞添え 11.5px）。
    // 数え漏らすと、**「⋮」を大きくしても緑のまま行がはみ出す**＝この PR が潰したのと同じ型の穴。
    const boxes = {
      名前: lineBoxPx(label, lh),
      添え: lineBoxPx(ruleBody(css, ".timeline-row-label .sub"), lh),
      "⋮": lineBoxPx(ruleBody(css, ".timeline-row-menu"), lh),
    };
    // ⚠️ **1つずつ見る**（PR #1132 の変異チェックで生き残った）＝いちばん高いものだけを見ると、
    // **集合から1つ落としても残りが収まっているので緑**になる（数え漏らしに気づけない）。
    for (const [what, px] of Object.entries(boxes)) {
      expect(Number.isFinite(px), `${what}の高さが読めない＝取り出しが実態と合っていない`).toBe(true);
      expect(px, `${what}が列の高さに収まっていない`).toBeLessThanOrEqual(TIMELINE_LANE_H_PX);
    }

    // ⚠️ **足さない**（#1122 の裏取りで判明）＝以前ここは `12 * lh + 10 * lh` と**足して**おり、
    // 「名前と添えの**2行**が収まる」＝**縦積み**の前提だった。CSS は #1104 で
    // `flex-direction: row`（横並び）に変えてあるので、実際の拘束は**いちばん高い1つ**。
    // 主張と実態が食い違ったまま（赤くならないので気づけない）にしない。
    // ⚠️ **`display: flex` も見る**（レビュー由来 ℹ️）＝`flex-direction` は `display: flex` が
    // 消えると**無視される宣言**なので、`block` にされると縦積みに戻っても緑のままになる。
    expect(label, "並べ方が変わった＝下の拘束が変わる").toContain("display: flex");
    expect(label, "横並びでなくなった＝下の拘束が変わる").toContain("flex-direction: row");
    // ⚠️ **いちばん高いのが誰かまで留める**（同上）＝集合から落ちた瞬間に赤くなる。
    // いま列の高さを決めているのは「⋮」（14px）で、名前（13.8px）より高い。
    const tallest = Object.entries(boxes).sort((a, b) => b[1] - a[1])[0]!;
    expect(tallest[0], "いちばん高いものが変わりました＝欄に並ぶものを数え直してください").toBe("⋮");
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

// 目盛りの中に敷いた**印の帯**（#1148／#1159）＝旗と再生ヘッドの掴み手を載せる。
//
// ⚠️ **jsdom は CSS を読まない**ので、描いて確かめられない。**書き方そのもの**を見る
//（この file の流儀＝#1104 で「列名の字の大きさを CSS から読む」と同じ）。
describe("印の帯は、目盛りを塞がず・はみ出さない（#1159）", () => {
  const overlay = (): string => {
    const body = ruleBody(css, ".timeline-ruler-overlay");
    expect(body, "印の帯の規則がありません").not.toBeNull();
    return body as string;
  };

  // ⚠️ **敷いても目盛りは使えたまま**＝塞ぐと、印を置いた辺りで**シークもスクラブもできなくなる**
  // （目盛りの本来の役目を、印のために奪う）。
  it("押したものは下の目盛りへ通す", () => {
    expect(/pointer-events\s*:\s*none/.test(overlay()), "印の帯が目盛りを塞いでいます").toBe(true);
  });

  // ⚠️ **高さは目盛りと同じ値から採る**＝写すと片方だけ動いて、印の帯が**下の帯へはみ出し**、
  // 帯の当たり判定を奪う（押しても選べない列ができる）。
  it("高さは目盛りと同じ変数から採る（写さない）", () => {
    const ruler = ruleBody(css, ".timeline-ruler");
    expect(ruler, "目盛りの規則がありません").not.toBeNull();
    for (const [name, body] of [["印の帯", overlay()], ["目盛り", ruler as string]] as const) {
      expect(
        /height\s*:\s*var\(--timeline-ruler-h\)/.test(body),
        `${name}の高さが変数から採られていません（写すと片方だけ動きます）`,
      ).toBe(true);
    }
    // ⚠️ **変数そのものは1か所で宣言する**＝2か所に書くと、どちらが効くか読めない。
    expect((css.match(/--timeline-ruler-h\s*:/g) ?? []).length, "高さの変数が1か所ではありません").toBe(1);
  });

  // ⚠️ **掴み手は印より上**＝置いた直後に「いまの時刻」が印に隠れない（#1159 レビュー由来）。
  it("掴み手は旗より上に描く", () => {
    const grip = ruleBody(css, ".timeline-playhead-grip");
    const flag = ruleBody(css, ".timeline-marker");
    const z = (body: string | null, name: string): number => {
      const m = /z-index\s*:\s*(\d+)/.exec(body ?? "");
      expect(m, `${name}の段がありません`).not.toBeNull();
      return Number(m?.[1]);
    };
    expect(z(grip, "掴み手")).toBeGreaterThan(z(flag, "旗"));
    // ⚠️ **どちらも列の名前の欄（5）より下**＝横へ送ったとき欄を突き抜けない。
    expect(z(grip, "掴み手")).toBeLessThan(5);
  });
});
