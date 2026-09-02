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

/**
 * 1つのファイルの本文から、**断りとして書かれた文**を拾う。
 *
 * ⚠️ **純粋関数として切り出す**＝ディレクトリを歩く形のままだと、
 * 「拾い方を消しても、いまのコードには漏れが無いので緑」になる（実際に変異チェックで緑だった）。
 * ここを直接叩けば、**拾い方そのもの**を検査できる。
 */
export function guidanceLiteralsIn(text: string): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  // ① 名前を付けた定数（`export const NAME = "…"`）。
  for (const m of text.matchAll(/^(?:export )?const ([A-Z_][A-Z_0-9]*)(?::[^=]+)? =\s*(['"])(.+?)\2;?$/gm)) {
    if (looksLikeGuidance(m[3]!)) out.push({ name: m[1]!, text: m[3]! });
  }
  // ② **名前を付けずにその場へ書いた文**（#981 レビュー 🟡）＝定数の形だけを見ていたので、
  // `setError("…")` / `return { error: "…" }` / `throw` に**直に書いた文が漏れていた**。
  // ⚠️ **断りの受け口へ渡しているものに絞る**＝ただ引用符の対を取ると、入力のヒント・見出し・
  // 下書きの中身まで拾ってしまい（実測 86 件）、全部を表へ載せると表の意味が消える
  //（`15 §6` は「エラー・状態」の正典であって、画面の文字すべての一覧ではない）。
  for (const m of text.matchAll(
    /(?:set\w*Error\(|\w*[eE]rror:\s*|throw new \w*Error\(|Message:\s*)(['"])((?:[^'"\\r\n]|\.){12,}?)\1/g,
  )) {
    const literal = m[2]!;
    if (!looksLikeGuidance(literal)) continue;
    if (out.some((o) => o.text === literal)) continue; // 定数として既に拾っている
    out.push({ name: `（その場に書いた文）${literal.slice(0, 12)}…`, text: literal });
  }
  return out;
}

/** `app`・`infrastructure` に**直に書かれた**断りを集める。 */
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
      for (const f of guidanceLiteralsIn(readFileSync(p, "utf8"))) out.push({ ...f, where: name });
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

// ⚠️ **拾い方そのものを検査する**（#981 レビュー）＝ディレクトリを歩く形だけだと、
// 「拾い方を消しても、いまのコードには漏れが無いので緑」になる（実際に変異チェックで緑だった）。
describe("断りの拾い方（#981 レビュー）", () => {
  it("名前を付けた定数を拾う", () => {
    const found = guidanceLiteralsIn(`export const X_FAILED = "できませんでした。もう一度お試しください。";`);
    expect(found.map((f) => f.name)).toEqual(["X_FAILED"]);
  });

  it("その場に書いた文も拾う（`setError` / `error:` / `throw`）", () => {
    const cases = [
      `setError("外せませんでした。設定から選び直してください。");`,
      `return { doc, error: "見つかりませんでした。設定から選び直してください。" };`,
      `throw new TimelineLoadError("読み取れませんでした。一覧から選び直してください。");`,
    ];
    for (const src of cases) expect(guidanceLiteralsIn(src), src).toHaveLength(1);
  });

  it("入力のヒント・見出し・下書きは拾わない（表の意味を薄めない）", () => {
    const cases = [
      `<input placeholder="会社名を入力してください" />`,
      `const HINT = "短い";`,
      `const SAMPLE = { narration: "人物が写っている素材があります。確認してください。" };`,
    ];
    for (const src of cases) expect(guidanceLiteralsIn(src), src).toEqual([]);
  });

  it("同じ文を二重に数えない（定数とその場書きが同じとき）", () => {
    const src = `const A_FAILED = "できませんでした。もう一度お試しください。";\nsetError("できませんでした。もう一度お試しください。");`;
    expect(guidanceLiteralsIn(src)).toHaveLength(1);
  });
});
