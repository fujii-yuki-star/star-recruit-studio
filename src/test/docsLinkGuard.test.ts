// 資料の**指し先が生きている**ことの門番（#1090）。
//
// ⚠️ **実際に踏んだ**（2026-09-10）＝`audits/` の報告と `research/` を `archive/` へ移したとき、
// **24 本のリンクが一度に切れた**。移した側（相対の深さが1つ増える）と、指していた側の両方。
// 型も lint も検査も全部緑で、**開くまで誰も気づけない**。
//
// ⚠️ **既存の門番は届いていなかった**＝`src/test/aiWorkGuideLinks.test.ts` は
// **`docs/ai_work_guides/` だけ**を見る（入口の指し先が生きているか）。
// 正典どうしのリンク（ADR ↔ 調査資料 ↔ 監査の報告）は誰も見ていなかった。
//
// ⚠️ **リンクの形だけでは足りない**（レビュー由来 🟡・2026-09-10）＝同じ移設で手で直した参照 13 か所は
// `[題](path)` ではなく**バッククォートや素の文で**書かれており、**壊れても緑のまま**だった
//（`ADR-0013` の5か所・`ux-model-reviewer`・`/final-audit` スキル・`h264Feature.ts` など）。
// だから**バッククォートの中の資料っぽい綴り**も見る。
//
// ⚠️ **`.claude/` も見る**＝スキルとエージェントが資料を名指しするので、移設で同じように切れる。
//
// ⚠️ **この門番が見ていないもの**（正直に書く）：
// - **バッククォートで囲っていない素の文**の中の綴り＝拾おうとすると、本文の言い回しまで
//   資料の名前と読んでしまう（誤検出は門番の信用を落とす）。**囲う側を直す**のが正解
//   （実際 `ux-model-reviewer.md` は囲っていなかったので囲った）。
// - **`src/**` のコメントの中の綴り**（`h264Feature.ts:2` に実在）＝雛形・例示が多く、
//   許可の一覧が太る。移設のたびに `grep` で拾う運用のまま。
// ⚠️ **外部 URL は見ない**（落ちていても直せない）。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** 走査する場所＝資料と、資料を名指しする側（スキル・エージェント）。 */
const ROOTS = ["docs", ".claude"] as const;

/** 走査するファイル（`.md`）。 */
function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".git") return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return markdownFiles(p);
    return name.endsWith(".md") ? [p] : [];
  });
}

/**
 * 本文から**相対リンクの指し先**を拾う（外部 URL・見出しだけの指定は除く）。
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
 * バッククォートの中に書かれた**資料の綴り**を拾う（`` `research/x.md` `` の形）。
 *
 * ⚠️ **`/` を含むものだけ**＝`` `11_SCHEMA_REFERENCE.md` `` のような**名前だけの言及**は場所を
 * 言っていないので対象外（拾うと誤検出になる）。
 * ⚠️ **`*` を許す**＝`` `research/2026-08-timeline-editing-ux*.md` `` のような書き方が実在する。
 */
export function docPathsInCode(markdown: string): string[] {
  const out: string[] = [];
  for (const m of markdown.matchAll(/`([^`\s]*\/[^`\s]*\.md)`/g)) {
    const p = (m[1] ?? "").split("#")[0]!.trim();
    if (p === "" || /^(https?:|mailto:)/.test(p)) continue;
    out.push(p);
  }
  return out;
}

/**
 * その綴りが**どこかに実在する**か（`*` は前方一致で見る）。
 *
 * ⚠️ **複数の起点から探す**＝バッククォートの綴りは、**そのファイルからの相対**で書かれることも、
 * **資料の根からの相対**で書かれることもある（`ADR-0013` は `research/x.md`＝隣の棚の意味）。
 * 場所の書き方まで揃えるのは別の話なので、ここでは「**実在するか**」だけを見る。
 */
export function resolvesSomewhere(spec: string, fromDir: string): boolean {
  const bases = [fromDir, "docs/yuko_recruit_docs", "docs", "."];
  for (const base of bases) {
    const full = resolve(base, spec);
    if (!spec.includes("*")) {
      if (existsSync(full)) return true;
      continue;
    }
    const dir = dirname(full);
    const head = basename(full).split("*")[0]!;
    if (!existsSync(dir)) continue;
    if (readdirSync(dir).some((f) => f.startsWith(head) && f.endsWith(".md"))) return true;
  }
  return false;
}

/**
 * **書き方の例**として置いてある指し先（実在しなくてよい）。
 *
 * ⚠️ **黙って外さない**＝ここに書いた分だけを見逃す。増やすときは理由を1行で。
 */
const TEMPLATE_LINKS = new Set([
  // `/adr-new` が「こう書く」を示すための雛形（`NNNN` は採番で埋まる）。
  "NNNN-slug.md",
  "docs/yuko_recruit_docs/adr/NNNN-<slug>.md",
  // `/final-audit` が保存先の**形**を示すもの（`<YYYY-MM>` は実行時に埋まる）。
  "docs/yuko_recruit_docs/archive/audits/<YYYY-MM>-<scope>-final-audit-report.md",
]);

const files = (): string[] => ROOTS.flatMap((r) => markdownFiles(r));

describe("資料の指し先が生きている（#1090）", () => {
  it("走査が空振りしていない（リンクも綴りも拾えている）", () => {
    // ⚠️ **拾えていないのに緑**を作らない＝拾い方が壊れたら、下の検査は無条件で通る。
    // ⚠️ **両方の棚を歩いていることを確かめる**＝片方だけに戻しても、いまの資料に切れが無い限り
    // 赤くならない（変異チェックで生き残った）。走査そのものを見る。
    const walked = files().map((p) => p.split("\\").join("/"));
    expect(walked.some((p) => p.startsWith("docs/")), "資料を1つも見ていない").toBe(true);
    expect(walked.some((p) => p.startsWith(".claude/")), "スキル・エージェントを1つも見ていない").toBe(true);
    const all = files().map((p) => readFileSync(p, "utf8"));
    expect(all.flatMap(relativeLinksIn).length, "相対リンクを1つも拾えていない").toBeGreaterThan(200);
    expect(all.flatMap(docPathsInCode).length, "資料の綴りを1つも拾えていない").toBeGreaterThan(20);
  });

  it("リンクの指し先がすべて実在する", () => {
    const broken = files().flatMap((p) =>
      relativeLinksIn(readFileSync(p, "utf8"))
        .filter((href) => !TEMPLATE_LINKS.has(href) && !existsSync(resolve(dirname(p), href)))
        .map((href) => `${p.replace(/\\/g, "/")} → ${href}`),
    );
    expect(broken, "資料を移したら、指している側も同じ変更で直してください").toEqual([]);
  });

  it("バッククォートで書かれた資料の綴りも実在する", () => {
    // ⚠️ **ここが本体**＝移設で手で直した参照の**半分以上**は、リンクの形をしていなかった。
    const broken = files().flatMap((p) =>
      docPathsInCode(readFileSync(p, "utf8"))
        .filter((spec) => !TEMPLATE_LINKS.has(spec) && !resolvesSomewhere(spec, dirname(p)))
        .map((spec) => `${p.replace(/\\/g, "/")} → ${spec}`),
    );
    expect(broken, "本文で名指しした資料も、移したら一緒に直してください").toEqual([]);
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

  it("本文の丸かっこに釣られない", () => {
    expect(relativeLinksIn("これは（かっこ）です")).toEqual([]);
  });

  it("バッククォートの綴りを拾う（`/` を含むものだけ）", () => {
    expect(docPathsInCode("調査＝`research/x.md`・EPIC #683")).toEqual(["research/x.md"]);
    // ⚠️ **名前だけの言及は拾わない**＝場所を言っていないので、実在を問えない。
    expect(docPathsInCode("正典は `11_SCHEMA_REFERENCE.md` にある")).toEqual([]);
  });

  it("`*` の書き方を、前方一致で見る", () => {
    // ⚠️ `research/2026-08-timeline-editing-ux*.md` のような書き方が実在する。
    expect(resolvesSomewhere("archive/research/2026-08-timeline-editing-ux*.md", "docs/yuko_recruit_docs")).toBe(true);
    expect(resolvesSomewhere("archive/research/この名前は無い*.md", "docs/yuko_recruit_docs")).toBe(false);
  });

  it("実在しない綴りを見つける", () => {
    expect(resolvesSomewhere("research/2026-08-timeline-editing-ux.md", "docs/yuko_recruit_docs")).toBe(false);
    expect(resolvesSomewhere("archive/research/2026-08-timeline-editing-ux.md", "docs/yuko_recruit_docs")).toBe(true);
  });
});
