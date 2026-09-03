// 削除の確認が、**共有の部品を通っている**か（#990）。
//
// ⚠️ **`DeleteConfirm` は「13 か所がこの部品を通るので、ここで直せば全部に効く」と書いてある**のに、
// 手書きの確認が**4か所**残っていた＝#354（焦点を戻す）・#963／#965（`Escape` の名簿）の直しが
// **そこだけ届いていなかった**。しかも1か所は **`削除する` → `やめる` の順**で、
// `06 §2-1` の【やめる（左）／削除する（右）】と**逆**＝キーボードで入った最初の停留点が
// **取り返しのつかない側**になっていた。
//
// ⚠️ **人の目では見つからない**（画面ごとに書き方が違う）ので、機械で見る。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 1ファイルの本文から、**手書きの削除確認**を拾う。
 *
 * 見分け方＝`btn-danger` のボタンに「削除する」と書いてあるもの。
 * ⚠️ **`DeleteConfirm` 自身は対象外**（そこが定義元）。
 * ⚠️ **純粋関数として切り出す**＝歩く形だけだと、拾い方を消しても
 * 「いまのコードに漏れが無いので緑」になる（このリポジトリで踏んだ形）。
 */
export function handWrittenDeleteConfirms(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  // `btn-danger` を持つ `<button ...>…削除する…</button>` を拾う。
  for (const m of code.matchAll(/<button[^>]*btn-danger[\s\S]{0,400}?<\/button>/g)) {
    if (/削除する/.test(m[0])) out.push(m[0].replace(/\s+/g, " ").slice(0, 80));
  }
  return out;
}

function hits(): { where: string; body: string }[] {
  const out: { where: string; body: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(name) || name.includes(".test.") || name === "DeleteConfirm.tsx") continue;
      for (const body of handWrittenDeleteConfirms(readFileSync(p, "utf8"))) out.push({ where: name, body });
    }
  };
  walk(join(process.cwd(), "src", "app", "screens"));
  walk(join(process.cwd(), "src", "app", "components"));
  return out;
}

// ⚠️ **通さなくてよいものは、理由を書いて明示的に外す**（黙って落とさない）。
const ALLOWED: Record<string, string> = {};

describe("削除の確認が、共有の部品を通っている（#990）", () => {
  it("走査が空振りしていない（`btn-danger` を拾えている）", () => {
    // ⚠️ **拾えていないのに緑**を作らない（拾い方が壊れたら、下の検査は無条件で通る）。
    const src = readFileSync(join(process.cwd(), "src", "app", "components", "DeleteConfirm.tsx"), "utf8");
    expect(src.includes("btn-danger"), "定義元から `btn-danger` を拾えていない＝走査が壊れている").toBe(true);
  });

  it("手書きの削除確認が残っていない", () => {
    const bad = hits().filter((h) => !ALLOWED[h.where]).map((h) => `${h.where}: ${h.body}`);
    expect(bad, "`DeleteConfirm` を通してください（行の中なら `inline`）").toEqual([]);
  });

  it("外した理由が空でない", () => {
    for (const [w, why] of Object.entries(ALLOWED)) expect(why.length, `${w} を外した理由が無い`).toBeGreaterThan(0);
  });
});

// ⚠️ **拾い方そのものを検査する**（歩く形だけだと、拾い方を消しても緑になる）。
describe("手書きの削除確認の拾い方", () => {
  it("危険色の「削除する」を拾う", () => {
    expect(handWrittenDeleteConfirms(`<button className="btn btn-danger" onClick={x}>削除する</button>`)).toHaveLength(1);
  });

  it("危険色でも「削除する」でなければ拾わない（バラす・保存しないで移るなど）", () => {
    expect(handWrittenDeleteConfirms(`<button className="btn btn-danger">バラす</button>`)).toEqual([]);
  });

  it("危険色でないボタンは拾わない", () => {
    expect(handWrittenDeleteConfirms(`<button className="btn btn-ghost">削除する</button>`)).toEqual([]);
  });

  it("コメントの中は拾わない", () => {
    expect(handWrittenDeleteConfirms(`// <button className="btn btn-danger">削除する</button>`)).toEqual([]);
  });
});
