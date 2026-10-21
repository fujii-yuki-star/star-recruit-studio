// 狭い窓で崩れていた所の約束（α 最終点検 2026-10-21・実機の release exe を 1024×700〜1280×800 で回して見つけた）。
//
// jsdom は大きさを計算しないので、**崩れを防いでいる CSS の約束**と**それが当たる骨組み**を見る。
// 実寸での確かめは PR 本文（重なり・横に流れる・切れて押せない を全画面で数えた結果）に書く。
//
// - 流れの帯：最小の窓で、進む／戻るのボタンが段の上に重なって「4 公開前チェック」等を隠していた（5画面すべて）。
// - ゆうこの欄・見た目パターンの見本：最小の窓で、2列の和が中身の幅を越えてページが横に流れていた。
// - たたき台の台本表：既定の窓（1280）でも列が押し込まれ、名前が1字ずつ縦に折れていた／最小の窓では右端の操作が切れていた。
// - 選択肢の並び（`segment`）：見た目パターンの「場面の種類」（11個）が1字ずつ縦に折れていた。
// - 見出しの行（`topbar`）：場面編集の道具が最小の窓で2行に折り返し、高さの決め打ちを越えて上下にはみ出していた。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (f: string): string => readFileSync(resolve(__dirname, f), "utf8");
const css = read("../styles/theme.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** 同じ選択子の規則を全部集める（並べ方と畳み方で規則が分かれていることがある）。 */
const rule = (sel: string): string =>
  css.split(`\n${sel} {`).slice(1).map((r) => r.slice(0, r.indexOf("}"))).join("\n");

/** `@media` / `@container` の塊（入れ子の波かっこを数えて閉じまで）。同じ条件の塊が複数あれば全部つなぐ。 */
const atBlock = (head: string): string => {
  const out: string[] = [];
  for (let i = css.indexOf(head); i >= 0; i = css.indexOf(head, i + head.length)) {
    let depth = 0;
    for (let j = css.indexOf("{", i); j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}" && --depth === 0) { out.push(css.slice(i, j)); break; }
    }
  }
  return out.join("\n");
};

describe("流れの帯は狭いと段を2行目へ下ろす", () => {
  it("帯は自分の幅を測られる器＝中の並べる器が畳む", () => {
    expect(rule(".flow-bar")).toMatch(/container-type:\s*inline-size/);
    expect(rule(".flow-bar-grid")).toMatch(/grid-template-areas:\s*"back steps next"/);
    const narrow = atBlock("@container (max-width: 916px)");
    expect(narrow, "狭いときの並べ方が無い").toMatch(/grid-template-areas:\s*"back next"\s*"steps steps"/);
  });

  it("骨組み＝帯の中に並べる器があり、両脇と段はその直下", () => {
    const src = read("../app/components/FlowBar.tsx");
    const grid = src.indexOf('className="flow-bar-grid"');
    expect(grid, "並べる器が無い").toBeGreaterThan(src.indexOf("data-testid=\"flow-bar\""));
    // `.flow-bar-grid > …` で当てているので、間に箱が挟まると効かない。
    for (const sel of [".flow-bar-grid > .flow-bar-side", ".flow-bar-grid > .flow-bar-steps", ".flow-bar-grid > .flow-bar-side--end"]) {
      expect(rule(sel), `${sel} が無い`).toMatch(/grid-area:/);
    }
  });
});

describe("2列の画面は狭いと1列にする（ページを横に流さない）", () => {
  it("ゆうこの欄", () => {
    expect(atBlock("@media (max-width: 1120px)")).toMatch(/\.content-with-yuko\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  });

  it("表を持つ画面（たたき台）はもっと早く1列にする", () => {
    expect(atBlock("@media (max-width: 1440px)")).toMatch(/\.content-with-yuko--table\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(read("../app/screens/DraftScreen.tsx")).toContain('className="content-with-yuko content-with-yuko--table"');
  });

  it("見た目パターンの見本", () => {
    expect(rule(".looks-layout")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+360px/);
    expect(atBlock("@media (max-width: 1120px)")).toMatch(/\.looks-layout\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(read("../app/screens/LooksScreen.tsx")).toContain('className="looks-layout"');
  });
});

describe("たたき台の台本表は最小幅を持ち、狭いときは表の中で流す", () => {
  it("表に最小幅・入れ物は横に流せる（切らない）", () => {
    const src = read("../app/screens/DraftScreen.tsx");
    expect(src).toMatch(/<table className="table" style=\{\{ minWidth: DRAFT_TABLE_MIN_WIDTH_PX \}\}>/);
    // `overflow: hidden` だと右端の「セリフ」「⋮」が切れて押せない。
    const card = src.slice(src.lastIndexOf('<div className="card"', src.indexOf("<table")), src.indexOf("<table"));
    expect(card).toContain('overflowX: "auto"');
    expect(card).not.toContain('overflow: "hidden"');
  });
});

describe("選択肢の並びは名前を折らず、並びを折り返す", () => {
  it("segment", () => {
    expect(rule(".segment")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".segment button")).toMatch(/white-space:\s*nowrap/);
  });
});

describe("見出しの行は折り返した道具のぶん伸びる", () => {
  it("topbar は高さを決め打たない（下限で持つ）", () => {
    for (const sel of [".topbar", ".dense .topbar"]) {
      const r = rule(sel);
      expect(r, `${sel} が無い`).not.toBe("");
      expect(r, `${sel} が高さを決め打っている`).not.toMatch(/(^|[^-])height:/m);
      expect(r).toMatch(/min-height:/);
    }
  });
});
