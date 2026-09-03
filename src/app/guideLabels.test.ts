// 手順書に書いた**画面の言葉**が、実際に画面にあるか（#1005〜#1009 の実機テスト用資料）。
//
// ⚠️ **資料は黙って腐る**＝画面の言葉を書き写した手順書は、ボタン名が変わった瞬間に嘘になる。
// しかも「資料が古い」は動かして初めて気づくので、**実機テストの現場で詰まる**（資料を頼りに
// 操作する人が、書いてある名前のボタンを探して見つからない）。
//
// ⚠️ **見るのは「太字の鉤括弧」だけ**＝手順書の中で **「〜」** と書いたものを「画面の言葉」とみなす。
// 地の文まで見ると、説明のための言い回しまで拾って**資料が書けなくなる**。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 手順書から「画面に出る言葉」として書いたものを拾う（**太字＋鉤括弧**だけ）。
 *
 * ⚠️ **書き方は2通りある**＝`**「押す言葉」**`（括弧ごと太字）と `「**押す言葉**」`（中だけ太字）。
 * 片方だけ拾うと、**書き方の違いで検査から外れる**（実際に片方しか拾えず空振りした）。
 */
export function quotedUiLabels(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\*\*「([^」*]{2,40})」\*\*/g)) out.add(m[1]!);
  for (const m of text.matchAll(/「\*\*([^」*]{2,40})\*\*」/g)) out.add(m[1]!);

  return [...out];
}

/** 画面・部品・文言定義の本文を全部つないだもの（この中に在れば「画面にある」とみなす）。 */
function appSources(): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
      parts.push(readFileSync(p, "utf8"));
    }
  };
  walk(join(process.cwd(), "src", "app"));
  return parts.join("\n");
}

const guide = (): string =>
  readFileSync(join(process.cwd(), "docs", "yuko_recruit_docs", "guides", "timeline-advanced-editing.md"), "utf8");

// ⚠️ **画面に無い言葉は、理由を書いて明示的に外す**（黙って落とさない）。
const NOT_IN_APP: Record<string, string> = {
  "（N個）": "ボタンの名前に数を差し込む形（`ここで終わる（{n}個）`）なので、そのままの文字列では在らない",
};

describe("手順書の画面の言葉が、実際に画面にある（実機テスト用資料）", () => {
  it("拾えている（走査が空振りしていない）", () => {
    // ⚠️ **拾えていないのに緑**を作らない（拾い方が壊れたら、下の検査は無条件で通る）。
    expect(quotedUiLabels(guide()).length, "手順書から画面の言葉を1つも拾えていない").toBeGreaterThanOrEqual(15);
  });

  it("書いた言葉が画面にある", () => {
    const src = appSources();
    const missing = quotedUiLabels(guide())
      .filter((w) => !NOT_IN_APP[w])
      .filter((w) => !src.includes(w));
    expect(missing, "手順書にある言葉が画面に無い（資料か画面のどちらかを直す）").toEqual([]);
  });

  it("外した理由が空でない", () => {
    for (const [w, why] of Object.entries(NOT_IN_APP)) {
      expect(why.length, `${w} を外した理由が書かれていない`).toBeGreaterThan(0);
    }
  });

  it("外したまま手順書から消えた語が残っていない（控えが腐らない）", () => {
    const words = new Set(quotedUiLabels(guide()));
    expect(Object.keys(NOT_IN_APP).filter((w) => !words.has(w)), "手順書から消えたのに外し続けている").toEqual([]);
  });
});

// ⚠️ **拾い方そのものを検査する**（このリポジトリで学んだ形＝ディレクトリを歩く形だけだと、
// 拾い方を消しても「いまの資料に漏れが無いので緑」になる）。
describe("画面の言葉の拾い方", () => {
  it("太字の鉤括弧を拾う", () => {
    expect(quotedUiLabels("**「声を作る」**を押す")).toEqual(["声を作る"]);
  });

  it("中だけ太字の書き方も拾う（書き方の違いで検査から外れない）", () => {
    expect(quotedUiLabels("「**声を作る**」を押す")).toEqual(["声を作る"]);
  });

  it("太字でない鉤括弧は拾わない（説明の言い回しまで縛らない）", () => {
    expect(quotedUiLabels("「なんとなく」の話")).toEqual([]);
  });

  it("同じ語を二重に数えない", () => {
    expect(quotedUiLabels("**「声を作る」** と **「声を作る」**")).toEqual(["声を作る"]);
  });
});
