// 資料の**相対リンクが生きている**ことの門番（#1090）。
//
// ⚠️ **実際に踏んだ**（2026-09-10）＝`audits/` の報告と `research/` を `archive/` へ移したとき、
// **24 本のリンクが一度に切れた**。移した側（相対の深さが1つ増える）と、指していた側の両方。
// 型も lint も検査も全部緑で、**開くまで誰も気づけない**。
//
// ⚠️ **既存の門番は届いていなかった**＝`src/test/aiWorkGuideLinks.test.ts` は
// **`docs/ai_work_guides/` だけ**を見る（入口の指し先が生きているか）。
// 正典どうしのリンク（ADR ↔ 調査資料 ↔ 監査の報告）は誰も見ていなかった。
//
// ⚠️ **見るのは相対リンクだけ**＝外部 URL は届くかどうかを機械で見ない（落ちていても直せない）。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** 走査する資料（`docs/` 以下すべての `.md`）。 */
function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".git") return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return markdownFiles(p);
    return name.endsWith(".md") ? [p] : [];
  });
}

/**
 * 本文から**相対リンクの指し先**を拾う（外部 URL・アンカーだけの指定は除く）。
 *
 * ⚠️ **純粋関数として切り出す**＝歩く形のままだと、拾い方を消しても
 * 「いまの資料に切れが無いので緑」になる（このリポジトリで繰り返し踏んでいる型）。
 */
export function relativeLinksIn(markdown: string): string[] {
  const out: string[] = [];
  for (const m of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = (m[1] ?? "").split("#")[0]!.trim();
    if (href === "") continue; // `#見出し` だけ＝同じ資料の中
    if (/^(https?:|mailto:|tel:)/.test(href)) continue;
    out.push(href);
  }
  return out;
}

/**
 * **書き方の例**として置いてある指し先（実在しなくてよい）。
 *
 * ⚠️ **黙って外さない**＝ここに書いた分だけを見逃す。増やすときは理由を1行で。
 */
const TEMPLATE_LINKS = new Set([
  // `/adr-new` が「こう書く」を示すための雛形（`NNNN` は採番で埋まる）。
  "NNNN-slug.md",
]);

describe("資料の相対リンクが生きている（#1090）", () => {
  it("走査が空振りしていない（リンクを拾えている）", () => {
    // ⚠️ **拾えていないのに緑**を作らない＝拾い方が壊れたら、下の検査は無条件で通る。
    const all = markdownFiles("docs").flatMap((p) => relativeLinksIn(readFileSync(p, "utf8")));
    expect(all.length, "資料から相対リンクを1つも拾えていない＝走査が壊れている").toBeGreaterThan(200);
  });

  it("指し先がすべて実在する", () => {
    const broken = markdownFiles("docs").flatMap((p) =>
      relativeLinksIn(readFileSync(p, "utf8"))
        .filter((href) => !TEMPLATE_LINKS.has(href) && !existsSync(resolve(dirname(p), href)))
        .map((href) => `${p.replace(/\\/g, "/")} → ${href}`),
    );
    expect(broken, "資料を移したら、指している側も同じ変更で直してください").toEqual([]);
  });
});

describe("門番自身の検査（わざと壊した入力）", () => {
  it("相対リンクを拾う", () => {
    expect(relativeLinksIn("見る→[題](../adr/0001-a.md)です")).toEqual(["../adr/0001-a.md"]);
  });

  it("外部 URL は拾わない（届くかどうかは機械で見ない）", () => {
    expect(relativeLinksIn("[外](https://example.com/x)")).toEqual([]);
    expect(relativeLinksIn("[送る](mailto:a@example.com)")).toEqual([]);
  });

  it("同じ資料の中の見出しだけの指定は拾わない", () => {
    expect(relativeLinksIn("[節へ](#見出し)")).toEqual([]);
  });

  it("アンカー付きでも、ファイルの方だけを見る", () => {
    expect(relativeLinksIn("[節](../11.md#7-6)")).toEqual(["../11.md"]);
  });

  it("画像や `code` の中の丸かっこに釣られない", () => {
    // ⚠️ リンクの形（`](…)`）だけを見る＝本文の丸かっこは拾わない。
    expect(relativeLinksIn("これは（かっこ）です")).toEqual([]);
  });
});
