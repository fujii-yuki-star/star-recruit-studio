// 画面が使っている見た目のクラスが、**実在すること**（#1246・ADR-0047 決定5）。
//
// ⚠️ **これは #1245 の原因そのもの**＝`btn-sm` は12か所で使われていたのに CSS に規則が無く、
// 「小さいボタンにしてある」と読めるコードが普通の大きさを出していた。**クラス名だけが約束していた**。
// 同じ回の走査で、ほかにも **`text-pretty`（21か所）・`form-error`（8か所）・`list-reset`（7か所）**など
// 計17個が効いていないと分かった（断りの文が本文と同じ色で出ていた、等）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { classNamesIn, cssClassesIn, selectorClassesIn, unknownClasses } from "./styleClasses";

/** `src` の下のファイルを拡張子で集める（⚠️ **置き場を一覧で持たない**＝足した所が黙って外れる）。 */
function filesUnder(dir: string, exts: string[], opts: { skipTests: boolean }): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!exts.includes(extname(name))) continue;
      if (opts.skipTests && name.includes(".test.")) continue;
      out.push(p);
    }
  };
  walk(dir);
  return out;
}

const read = (files: string[]): string => files.map((f) => readFileSync(f, "utf8")).join("\n");

/** 画面（`src/app`）が使っているクラス。 */
const screenFiles = (): string[] => filesUnder(join(process.cwd(), "src", "app"), [".ts", ".tsx"], { skipTests: true });
/** CSS は `src` のどこにあっても拾う（⚠️ 実際 `src/styles` と `src/app/components` に分かれている）。 */
const cssFiles = (): string[] => filesUnder(join(process.cwd(), "src"), [".css"], { skipTests: false });
/** 目印として使っている所（検査の中も含む＝掴むための名前は検査からも指される）。 */
const allSource = (): string[] => filesUnder(join(process.cwd(), "src"), [".ts", ".tsx"], { skipTests: false });

describe("見た目のクラスは実在する（#1246）", () => {
  it("画面が使っているクラスは、CSS にあるか、目印として使われている", () => {
    const used = classNamesIn(read(screenFiles()));
    const defined = cssClassesIn(read(cssFiles()));
    const hooks = selectorClassesIn(read(allSource()));
    expect(
      unknownClasses(used, defined, hooks),
      "約束だけして実体が無いクラス（CSS に規則を足すか、使うのをやめる）",
    ).toEqual([]);
  });

  // ⚠️ **走査が空振りしていないか**＝歩けていなければ「使っているクラスが0個」で必ず緑になる。
  it("走査が届いている（画面・CSS・目印のどれも拾えている）", () => {
    expect(screenFiles().length, "画面のファイル").toBeGreaterThan(100);
    expect(cssFiles().length, "CSS のファイル").toBeGreaterThanOrEqual(3);
    expect(cssFiles().some((f) => f.endsWith("timeline.css")), "`src/styles` の外の CSS も見ている").toBe(true);
    expect(new Set(classNamesIn(read(screenFiles()))).size, "使っているクラスの数").toBeGreaterThan(120);
    expect(new Set(cssClassesIn(read(cssFiles()))).size, "CSS にあるクラスの数").toBeGreaterThan(150);
    expect(new Set(selectorClassesIn(read(allSource()))).size, "目印として使っているクラスの数").toBeGreaterThan(3);
  });

  // ⚠️ **実数で留める**＝黙って減らない（走査が壊れて0件になっても、上の検査だけでは緑になりうる）。
  it("使っているクラスの数を実数で留める", () => {
    // ⚠️ **増減したら中身を確かめてから数を直す**（数だけ合わせない）。
    // ⚠️ **170 であって 172 ではない**＝組み立ての断片2つ（`panel-drop-line--` / `timeline-clip--`）を
    //   落としたぶん。走査を書く前の下調べでは 172 と出ていたので、数だけ写すと合わない。
    expect(new Set(classNamesIn(read(screenFiles()))).size).toBe(170);
  });
});

describe("拾い方そのもの（走る所と同じ道を直接叩く）", () => {
  it("`className` に直に書かれたものを拾う（3つの書き方）", () => {
    expect(classNamesIn('<i className="btn btn-sm" />')).toEqual(["btn", "btn-sm"]);
    expect(classNamesIn('<i className={"card text-sm"} />')).toEqual(["card", "text-sm"]);
    expect(classNamesIn("<i className={`row gap-sm`} />")).toEqual(["row", "gap-sm"]);
  });

  // ⚠️ **差し込みは空白に置き換える**＝前後がくっついて、在りもしない名前に見えるのを防ぐ。
  it("差し込みが末尾にあるとき", () => {
    expect(classNamesIn("<i className={`nav-item${on ? \" active\" : \"\"}`} />")).toEqual(["nav-item"]);
  });

  // ⚠️ **末尾の例だけでは試したことにならない**（変異チェックで露見）＝末尾なら、空白に置き換えても
  //   消しても結果は同じ（等価）。**真ん中に差し込みがある**形でしか、くっつきは起きない。
  it("差し込みが真ん中にあるとき、前後をくっつけて別の名前にしない", () => {
    expect(classNamesIn("<i className={`row-${n}-end`} />")).toEqual([]);
  });

  // ⚠️ **組み立ての断片は見ない**＝`timeline-clip--${kind}` の前半は、そういう名前のクラスではない。
  it("末尾が `-` の断片は数えない", () => {
    expect(classNamesIn("<i className={`timeline-clip--${kind}`} />")).toEqual([]);
  });

  it("CSS の規則を拾う。⚠️ 中身の値は規則と数えない", () => {
    expect(cssClassesIn(".btn { color: red }")).toEqual(["btn"]);
    expect(cssClassesIn('.a { content: ".not-a-rule" }')).toEqual(["a"]);
  });

  it("目印として使っているクラスを拾う", () => {
    expect(selectorClassesIn('document.querySelector(".free-layout-overlay")')).toContain("free-layout-overlay");
    expect(selectorClassesIn("el.closest('.drag-handle')")).toContain("drag-handle");
  });

  it("CSS にも目印にも無いものだけを挙げる", () => {
    expect(unknownClasses(["a", "b", "c"], ["a"], ["b"])).toEqual(["c"]);
    expect(unknownClasses(["a"], ["a"], [])).toEqual([]);
  });
});
