// 画面・外部連携に**直に書かれた「次の行動つきの断り」**が、`15 §6` の表に載っているか（#978）。
//
// ⚠️ **`errorStateTable.test.ts` の走査は `src/domain` の `warn(` だけ**＝
// 「実装にある文言は必ず表にも行がある」の向きは、**手で登録した families のキー**しか回らないので、
// `app/`・`infrastructure/` に直書きされた断りは**表にも検査にも載らない**。
// 同じ形で2度塞いでいる（α-6 🟡18・α-7 🟡）＝**走査を広げないと3度目が来る**。
//
// ⚠️ **見分け方は「次の行動が書いてあるか」**（§2-5）＝断りの文は必ず次の行動で終わる。
// ラベルやボタン名はそう書かないので、これで実用上は分かれる。
// ⚠️ **完璧な判別はできない**＝取りこぼす形（組み立てる文・関数が返す文）は残る。
// そこは `codeMessages()` の登録が受け持つ＝**この検査は「直書きの取りこぼし」だけを見る**。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** 次の行動が書いてある文か（§2-5 の断りの形）。 */
const looksLikeGuidance = (text: string): boolean =>
  /ください|もう一度|選び直/.test(text) && text.length >= 12;

interface Found {
  name: string;
  text: string;
  where: string;
}

/** `app`・`infrastructure` に**直に書かれた**断りの定数を集める。 */
function directGuidanceConstants(): Found[] {
  const out: Found[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
      const text = readFileSync(p, "utf8");
      for (const m of text.matchAll(/^(?:export )?const ([A-Z_][A-Z_0-9]*)(?::[^=]+)? =\s*(['"])(.+?)\2;?$/gm)) {
        if (looksLikeGuidance(m[3]!)) out.push({ name: m[1]!, text: m[3]!, where: name });
      }
    }
  };
  walk(join(process.cwd(), "src", "app"));
  walk(join(process.cwd(), "src", "infrastructure"));
  return out;
}

/** `15 §6` の本文（行の照合ではなく、文が載っているかだけを見る）。 */
const tableText = (): string =>
  readFileSync(join(process.cwd(), "docs", "yuko_recruit_docs", "15_ERROR_STATE_MODEL.md"), "utf8");

// ⚠️ **表に載せない**と決めたものは、**理由を書いて明示的に外す**（黙って落とさない）。
// 増やすときは「なぜ表に無くてよいか」を必ず書く（空欄で増やせないよう検査する）。
const NOT_IN_TABLE: Record<string, string> = {};

describe("画面に直書きした断りも、表に載っている（#978）", () => {
  const found = directGuidanceConstants();

  it("走査が空振りしていない", () => {
    // ⚠️ **拾えていないのに緑**を作らない（走査が壊れたら、下の検査は無条件で通る）。
    expect(found.length, "断りの定数を1つも拾えていない＝走査が壊れている").toBeGreaterThanOrEqual(5);
  });

  it("拾った断りは、表に載っているか、理由つきで外してある", () => {
    const md = tableText();
    const missing = found
      .filter((f) => !NOT_IN_TABLE[f.name])
      .filter((f) => !md.includes(f.text.replace(/。$/, "")))
      .map((f) => `${f.name}（${f.where}）: ${f.text}`);
    expect(missing, "表に無い断りがある（`15 §6` へ行を足すか、理由つきで NOT_IN_TABLE へ）").toEqual([]);
  });

  it("外した理由が空でない", () => {
    for (const [name, why] of Object.entries(NOT_IN_TABLE)) {
      expect(why.length, `${name} を外した理由が書かれていない`).toBeGreaterThan(0);
    }
  });

  it("外したまま実装から消えた行が残っていない（控えが腐らない）", () => {
    const names = new Set(found.map((f) => f.name));
    const stale = Object.keys(NOT_IN_TABLE).filter((n) => !names.has(n));
    expect(stale, "実装から消えたのに外し続けている").toEqual([]);
  });
});
