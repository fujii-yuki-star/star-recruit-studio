// 欄のキー操作が、**日本語の変換中を除外している**か（#989）。
//
// ⚠️ **同じ形で4か所抜けていた**（グループ名・自由配置の要素名・見た目パターンの文字欄・動画の名前）。
// 判定（`isImeComposing`）は前からあり、8か所は守れていたのに、**書き写しで増えるうちに漏れた**。
// 人の目では「どの欄が守っていてどの欄が守っていないか」を数えられないので、機械で見る。
//
// ⚠️ **実害は `Enter` 側がはっきりしている**＝変換中の `Enter` は「変換を確定する」なので、
// 奪うと**変換前の文字のまま欄が閉じる**。`Escape`（＝変換をやめる）も打ちかけが消える。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** 変換中を見ている書き方（どれか1つあれば守れているとみなす）。 */
const GUARDS = ["isComposing", "isImeComposing", "shouldIgnoreShortcut", "renameFieldKeys", "isComposingReact"];

/**
 * 1ファイルの本文から、**`Enter`／`Escape` を見ている `onKeyDown`** を拾い、守れていないものを返す。
 *
 * ⚠️ **純粋関数として切り出す**＝ディレクトリを歩く形のままだと、
 * 「拾い方を消しても、いまのコードに漏れが無いので緑」になる（このリポジトリで踏んだ形）。
 * ⚠️ **完璧な構文解析はしない**＝`onKeyDown` から次の `onKeyDown`（またはファイル末）までを
 * ひとかたまりと見る。数が合わなくなったら人が読む、という粒度で足りる。
 */
export function unguardedKeyHandlers(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  const parts = code.split(/onKeyDown\s*=/).slice(1);
  for (const raw of parts) {
    // 次のプロパティ（`onX=` / `/>`）までを、その handler の本体とみなす。
    const body = raw.split(/\n\s*(?:on[A-Z]\w*\s*=|\/>|>)/)[0] ?? raw;
    if (!/e\.key\s*===\s*"(Enter|Escape)"/.test(body)) continue;
    if (GUARDS.some((g) => body.includes(g))) continue;
    out.push(body.trim().slice(0, 70).replace(/\s+/g, " "));
  }
  return out;
}

/** 走査の対象（画面と部品＝利用者が文字を打つ層）。 */
function hits(): { where: string; body: string }[] {
  const out: { where: string; body: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
      for (const body of unguardedKeyHandlers(readFileSync(p, "utf8"))) out.push({ where: name, body });
    }
  };
  walk(join(process.cwd(), "src", "app", "screens"));
  walk(join(process.cwd(), "src", "app", "components"));
  return out;
}

// ⚠️ **守らなくてよいものは、理由を書いて明示的に外す**（黙って落とさない）。
const ALLOWED: Record<string, string> = {};

describe("欄のキー操作が、日本語の変換中を除外している（#989）", () => {
  it("走査が空振りしていない（`onKeyDown` を拾えている）", () => {
    // ⚠️ **拾えていないのに緑**を作らない（拾い方が壊れたら、下の検査は無条件で通る）。
    const src = readFileSync(join(process.cwd(), "src", "app", "screens", "HomeScreen.tsx"), "utf8");
    expect(src.split("onKeyDown").length - 1, "画面から `onKeyDown` を1つも拾えていない").toBeGreaterThanOrEqual(1);
  });

  it("`Enter`／`Escape` を見ている欄は、変換中を除外している", () => {
    const bad = hits().filter((h) => !ALLOWED[h.where]).map((h) => `${h.where}: ${h.body}`);
    expect(bad, "変換中の `Enter`／`Escape` を奪っています（`renameFieldKeys` を通してください）").toEqual([]);
  });

  it("外した理由が空でない", () => {
    for (const [w, why] of Object.entries(ALLOWED)) expect(why.length, `${w} を外した理由が無い`).toBeGreaterThan(0);
  });
});

// ⚠️ **拾い方そのものを検査する**（歩く形だけだと、拾い方を消しても緑になる）。
describe("キー操作の拾い方", () => {
  it("守っていない `onKeyDown` を拾う", () => {
    expect(unguardedKeyHandlers(`onKeyDown={(e) => { if (e.key === "Enter") commit(); }}`)).toHaveLength(1);
  });

  it("守っているものは拾わない", () => {
    const ok = [
      `onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) commit(); }}`,
      `onKeyDown={renameFieldKeys({ commit })}`,
      `onKeyDown={(e) => { if (isComposingReact(e)) return; if (e.key === "Escape") blur(); }}`,
    ];
    for (const src of ok) expect(unguardedKeyHandlers(src), src).toEqual([]);
  });

  it("`Enter`／`Escape` を見ていない `onKeyDown` は対象外（矢印だけの欄など）", () => {
    expect(unguardedKeyHandlers(`onKeyDown={(e) => { if (e.key === "ArrowUp") up(); }}`)).toEqual([]);
  });

  it("コメントの中は拾わない", () => {
    expect(unguardedKeyHandlers(`// onKeyDown={(e) => { if (e.key === "Enter") x(); }}`)).toEqual([]);
  });
});
