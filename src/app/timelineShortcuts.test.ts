// 近道キーの一覧と、画面が実際に受けているキーを食い違わせない（ADR-0048・#1256 c6）。
//
// ⚠️ **キーを足したのに一覧に書き忘れる**／**消したのに一覧に残る**を止める。
// 画面の受け口は `e.key === "…"` と `toLowerCase() === "…"` の形で書いてある（その形で拾う）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TIMELINE_SHORTCUTS } from "./timelineShortcuts";

/** キーを受けているファイル（タイムライン編集で効くもの）。 */
const SOURCES = [
  "src/app/screens/TimelineProjectScreen.tsx",
  "src/app/components/layout/PanelLayoutView.tsx", // `` ` ``（欄を広げる）
  "src/app/hooks/useUndoRedoShortcuts.ts", // Ctrl+Z／Ctrl+Y
];

function handledKeys(): Set<string> {
  const out = new Set<string>();
  for (const f of SOURCES) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:e\.key|key|toLowerCase\(\)) (?:===|!==) "([^"]+)"/g)) out.add(m[1].toLowerCase());
    // 欄を広げるキーは定数で持っている（`MAXIMIZE_KEY`）。
    for (const m of src.matchAll(/MAXIMIZE_KEY = "([^"]+)"/g)) out.add(m[1].toLowerCase());
  }
  return out;
}

const listed = new Set(TIMELINE_SHORTCUTS.flatMap((s) => s.codes.map((c) => c.toLowerCase())));

describe("近道キーの一覧（#1256 c6）", () => {
  // ⚠️ **走査そのものを検査する**＝拾えていないのに緑、を防ぐ。
  it("受け口のキーを拾えている", () => {
    const keys = handledKeys();
    for (const k of [" ", "delete", "k", "m", "?", "`", "z"]) expect(keys.has(k), `${k} を拾えていない`).toBe(true);
  });

  it("画面が受けているキーは、全部一覧にある", () => {
    const missing = [...handledKeys()].filter((k) => !listed.has(k)).sort();
    expect(missing, "一覧に書いていないキーがある").toEqual([]);
  });

  it("一覧にあるキーは、どこかで受けている（消したのに残っていない）", () => {
    const keys = handledKeys();
    const stale = [...listed].filter((k) => !keys.has(k)).sort();
    expect(stale, "受けていないキーが一覧に残っている").toEqual([]);
  });
});
