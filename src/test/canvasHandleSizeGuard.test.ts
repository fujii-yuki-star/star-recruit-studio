// キャンバスの上で掴む物（大きさ・回転の取っ手と、動きの道筋の点）の大きさは1か所で決める（ADR-0047 の寸法の正・#1482）。
//
// ⚠️ 以前は取っ手が `width: 12, height: 12` を9か所に書き、道筋の点は CSS に `12px` を別に書いていた＝
//   どれか1つだけ変えると、**同じ「掴む物」なのに指の届く量が部品ごとに割れる**（見た目＝当たり判定・決定3）。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS = join(process.cwd(), "src", "app", "components");
const read = (p: string): string => readFileSync(p, "utf8");

describe("キャンバスの掴む物の大きさ（#1482）", () => {
  it("トークンは theme.css の :root に1つだけ", () => {
    const css = read(join(process.cwd(), "src", "styles", "theme.css"));
    expect(css.match(/--canvas-handle-size\s*:/g)?.length).toBe(1);
  });

  it("取っ手を描く画面は数字を書かずトークンを使う（実数で留める）", () => {
    const files = readdirSync(COMPONENTS).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));
    const literal: string[] = [];
    let uses = 0;
    for (const f of files) {
      const src = read(join(COMPONENTS, f));
      if (/width:\s*12,\s*height:\s*12\b/.test(src)) literal.push(f);
      uses += src.match(/width: CANVAS_HANDLE_SIZE,\s*height: CANVAS_HANDLE_SIZE,/g)?.length ?? 0;
    }
    expect(literal).toEqual([]);
    // 自由配置（要素の角・回転・まとまりの角・回転・複数選択の角）5＋見た目パターン編集（角・回転・まとまりの角・回転）4。
    // ⚠️ 走査そのものが空振りしていないことも、この数で見る。
    expect(uses).toBe(9);
  });

  it("動きの道筋の点も同じトークン（中心合わせも同じ値から）", () => {
    const css = read(join(COMPONENTS, "timeline.css"));
    const rule = /\.motion-path-key\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/width:\s*var\(--canvas-handle-size\)/);
    expect(rule).toMatch(/height:\s*var\(--canvas-handle-size\)/);
    expect(rule).toMatch(/margin:\s*calc\(var\(--canvas-handle-size\) \/ -2\)/);
    // 大きさの宣言に数字を戻さない（枠の太さ `border: 2px` は大きさではないので見ない）。
    expect(rule).not.toMatch(/(?:^|[;\s])(?:width|height|margin):[^;]*\d+px/);
  });
});
