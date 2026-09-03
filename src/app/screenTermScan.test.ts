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

/**
 * 画面に出さない語（§2-3・`16 §1` の置き換え表）。
 *
 * ⚠️ **`uiLabels.test.ts` の一覧とは別に持つ**＝あちらは文言の集約先を見る門番で、
 * こちらは**画面の直書き**を見る門番。射程が違うので、片方に足しても他方には効かない
 *（実際、「ナレーション」を `uiLabels.test.ts` へ足しても画面の直書きは素通りだった）。
 */
const BANNED_IN_SCREENS = [
  "ナレーション",
  "レンダリング",
  "バリデーション",
  "スキーマ",
  // ⚠️ **素の「テンプレート」も入れる**（#984 レビュー ℹ️）＝`16 §1`／`06 §3` は
  // `template / テンプレート` を内部用語（表示は「見た目パターン」）としているのに、
  // `テンプレートID` しか入っておらず「テンプレートを選ぶ」のような直書きを拾えなかった。
  "テンプレート",
  "アセット",
  "プロバイダ",
  "キーフレーム",
];

/** 画面に出る文字とみなす＝**日本語を含む**文字列リテラルと、JSX のテキスト。 */
const hasJapanese = (s: string): boolean => /[ぁ-んァ-ヶ一-龠]/.test(s);

interface Hit {
  word: string;
  text: string;
  where: string;
}

/**
 * 1ファイルの本文から、**画面に出る日本語**を拾って禁止語を探す。
 *
 * ⚠️ **純粋関数として切り出す**＝ディレクトリを歩く形のままだと、
 * 「拾い方を消しても、いまのコードに漏れが無いので緑」になる（#981 で踏んだ）。
 */
export function bannedTermsIn(text: string, banned: readonly string[] = BANNED_IN_SCREENS): { word: string; text: string }[] {
  const out: { word: string; text: string }[] = [];
  // ⚠️ **コメントを外す**＝説明文には実装用語が出てよい（§2-3 が縛るのは表示だけ）。
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const seen = new Set<string>();
  const add = (raw: string): void => {
    const s = raw.trim();
    if (!s || !hasJapanese(s) || seen.has(s)) return;
    seen.add(s);
    for (const word of banned) if (s.includes(word)) out.push({ word, text: s });
  };
  // ① 文字列リテラル（属性・変数・関数の引数）。
  for (const m of code.matchAll(/(['"])((?:[^'"\\\r\n]|\\.)+)\1/g)) add(m[2]!);
  // ② JSX のテキスト（タグとタグの間）。`{...}` の式は中身を見ない（識別子が混じるだけ）。
  for (const m of code.matchAll(/>([^<>{}]+)</g)) add(m[1]!);
  return out;
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
      for (const h of bannedTermsIn(readFileSync(p, "utf8"))) out.push({ ...h, where: name });
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
    expect(bannedTermsIn(`<label>ナレーション音量</label>`)).toHaveLength(1);
  });

  it("文字列リテラルを拾う（属性・データの値）", () => {
    expect(bannedTermsIn(`const LANES = [{ sub: "ナレーション" }];`)).toHaveLength(1);
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
