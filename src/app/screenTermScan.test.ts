// 画面・部品に**直に書かれた文字**へ、実装用語が混じっていないか（§2-3・`16 §1`・`06 §3`）。
//
// ⚠️ **既存の走査は届いていなかった**（UI/UX レビュー 🔴）＝
// `uiLabels.test.ts` の禁止語走査は **`uiLabels.ts` の Record と共有関数**しか見ておらず、
// `uiMessageScan.test.ts` は **「次の行動つきの断り」**しか見ない。
// そのため **`<label>ナレーション音量</label>` のような画面直書きのラベルは、どちらにも掛からなかった**
//（実際に2か所〔音量のラベル・見わたす列の添え字〕が画面に出ていた）。
//
// ⚠️ **見るのは「画面に出る文字」だけ**＝識別子・型・コメント・import は対象外（§2-3 の射程）。
// 完璧な判別はできないので、**日本語を含む文字列**に絞り、そこへ禁止語が入っていないかだけを見る。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// ⚠️ **拾い方と禁止語は1か所**（`src/test/uiTerms.ts`）＝Rust が返す文を見る門番
// （`src/test/rustUserMessageGuard.test.ts`）も同じものを使う（#1111）。
import { bannedTermsIn, hasJapanese } from "../test/uiTerms";

/**
 * 1つのファイルから、画面に出る文字に混じった禁止語を拾う。
 *
 * ⚠️ **1つの関数にまとめる**（#1111）＝下の「拾い方」の検査が**この道**を通るようにするため。
 * 走る所と自己検査が別の道だと、走る所だけ物差しを狭めても誰も気づかない（変異チェックで露見）。
 */
export function screenTermHitsIn(text: string): { word: string; text: string }[] {
  return bannedTermsIn(text);
}

/** 見つかった禁止語（どのファイルの、どの文か）。 */
interface Hit {
  word: string;
  text: string;
  where: string;
}

/** 走査の対象（画面と部品＝利用者が見る層）。 */
function screenHits(): Hit[] {
  const out: Hit[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
      for (const h of screenTermHitsIn(readFileSync(p, "utf8"))) out.push({ ...h, where: name });
    }
  };
  walk(join(process.cwd(), "src", "app", "screens"));
  walk(join(process.cwd(), "src", "app", "components"));
  return out;
}

// ⚠️ **出してよいものは、理由を書いて明示的に外す**（黙って落とさない）。
// クレジット表示は技術語が出てよい（ADR-0003・`13 §4`）。
const ALLOWED: Record<string, string> = {
  "AboutScreen.tsx": "クレジット表示は技術語が出てよい（ADR-0003・`13 §4`）",
};

describe("画面に直書きした文字に、実装用語が混じっていない（§2-3）", () => {
  it("走査が空振りしていない（日本語を拾えている）", () => {
    // ⚠️ **拾えていないのに緑**を作らない＝走査が壊れたら、下の検査は無条件で通る。
    const sample = readFileSync(join(process.cwd(), "src", "app", "screens", "HomeScreen.tsx"), "utf8");
    const code = sample.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const japanese = [...code.matchAll(/(['"])((?:[^'"\\\r\n]|\\.)+)\1/g)].filter((m) => hasJapanese(m[2]!));
    expect(japanese.length, "画面から日本語を1つも拾えていない＝走査が壊れている").toBeGreaterThanOrEqual(10);
  });

  it("禁止語が画面に出ていない", () => {
    const bad = screenHits()
      .filter((h) => !ALLOWED[h.where])
      .map((h) => `${h.where}: 「${h.word}」← ${h.text}`);
    expect(bad, "画面に出す言葉を `16 §1`／`06 §3` の置き換え表に合わせてください").toEqual([]);
  });
});

// ⚠️ **拾い方そのものを検査する**（#981 で学んだ形）＝
// ディレクトリを歩く形だけだと、拾い方を消しても「いまのコードに漏れが無いので緑」になる。
describe("拾い方（画面の直書き）", () => {
  it("JSX のテキストを拾う", () => {
    expect(screenTermHitsIn(`<label>ナレーション音量</label>`)).toHaveLength(1);
  });

  it("文字列リテラルを拾う（属性・データの値）", () => {
    expect(screenTermHitsIn(`const LANES = [{ sub: "ナレーション" }];`)).toHaveLength(1);
    expect(bannedTermsIn(`<span title="ナレーションの設定" />`)).toHaveLength(1);
  });

  it("コメントは拾わない（説明文に実装用語が出てよい）", () => {
    expect(bannedTermsIn(`// ナレーションの音量を持つ\nconst x = 1;`)).toEqual([]);
    expect(bannedTermsIn(`/** ナレーション（内部用語） */\nconst y = 2;`)).toEqual([]);
  });

  it("識別子は拾わない（日本語を含まないもの）", () => {
    expect(bannedTermsIn(`const narrationVolume = 1; type NarrationLine = {};`)).toEqual([]);
  });

  it("同じ文を二重に数えない", () => {
    expect(bannedTermsIn(`<b>ナレーション音量</b>\n<i>ナレーション音量</i>`)).toHaveLength(1);
  });
});
