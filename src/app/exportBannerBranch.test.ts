// 書き出し中の知らせが、**画面のどの枝にも置いてある**か（#953／#984 レビュー）。
//
// ⚠️ **同じ形で4回落ちている**＝たたき台（#952）・公開前チェック・仕上がり確認・見た目パターンの2画面。
// 早い `return`（場面ゼロ・未選択などの空状態）のある画面は、**片方に置くと、もう片方でだけ出ない**。
// しかも落ちる枝が画面ごとにバラバラ（公開前チェックは本編に無く、仕上がり確認は空状態に無かった＝**互いに逆**）。
//
// ⚠️ **人の目では見つからない**＝どの画面に枝がいくつあるかを数えないと分からないので、機械で見る。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 書き出し中の知らせを持つべき画面と、その置き方。
 *
 * - `banner`＝`<ExportLockBanner />` を直に置く（枝ごとに1つ）
 * - `lock`＝`<ExportLock>` で包む（中身ごと止める＝バナーも内側で出る）
 */
const SCREENS: { file: string; why: string }[] = [
  { file: "DraftScreen.tsx", why: "たたき台（#952 で両枝へ置いた）" },
  { file: "PrecheckScreen.tsx", why: "公開前チェック（本編の枝が落ちていた）" },
  { file: "PreviewScreen.tsx", why: "仕上がり確認（空状態の枝が落ちていた）" },
  { file: "LooksScreen.tsx", why: "見た目パターンの一覧（空状態の枝が落ちていた）" },
  { file: "LooksEditScreen.tsx", why: "見た目パターンの編集（空状態の枝が落ちていた）" },
];

/**
 * 画面の本文から「早い `return`（枝）の数」と「知らせの置かれた数」を数える。
 *
 * ⚠️ **純粋関数として切り出す**＝ディレクトリを歩く形のままだと、
 * 「数え方を消しても、いまのコードに漏れが無いので緑」になる（#981 で踏んだ）。
 * ⚠️ **完璧な構文解析はしない**＝`return (` で始まる塊を「画面を描く枝」とみなす。
 * 数が合わなくなったら人が読む、という粒度で足りる（そこは正直に書く）。
 */
export function branchCounts(text: string): { branches: number; notices: number } {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // 画面まるごとを描く枝＝**`main-scroll` の入れ物**。
  // ⚠️ **`return (` の形では数えない**（#984）＝`map` の中の `return (` まで拾ってしまい、
  // **一覧を描くコールバックを「画面の枝」と誤って数えた**。インデントで絞る形も試したが、
  // 画面ごとの書き方の差で崩れる。**「画面まるごとの入れ物がいくつあるか」で数えるほうが素直**。
  const branches = [...code.matchAll(/className="main-scroll/g)].length;
  // 知らせ＝直に置いたバナーか、中身ごと包む `ExportLock`（**JSX として書かれたものだけ**＝
  // `import` 行を数えないよう `<` から始まるものに限る）。
  const notices =
    [...code.matchAll(/<ExportLockBanner\b/g)].length + [...code.matchAll(/<ExportLock\b(?!anner)/g)].length;
  return { branches, notices };
}

const read = (file: string): string =>
  readFileSync(join(process.cwd(), "src", "app", "screens", file), "utf8");

describe("書き出し中の知らせが、画面のどの枝にもある（#953／#984）", () => {
  it("数え方が空振りしていない", () => {
    // ⚠️ **拾えていないのに緑**を作らない（数え方が壊れたら、下の検査は無条件で通る）。
    const c = branchCounts(read("DraftScreen.tsx"));
    expect(c.branches, "枝を1つも数えられていない").toBeGreaterThanOrEqual(2);
    expect(c.notices, "知らせを1つも数えられていない").toBeGreaterThanOrEqual(2);
  });

  it("枝の数だけ知らせがある", () => {
    const bad = SCREENS.map(({ file, why }) => {
      const { branches, notices } = branchCounts(read(file));
      return notices >= branches ? null : `${file}（${why}）: 枝 ${branches} に対して知らせ ${notices}`;
    }).filter(Boolean);
    expect(bad, "早い `return` のある画面は、**全部の枝に**書き出し中の知らせを置いてください").toEqual([]);
  });
});

// ⚠️ **数え方そのものを検査する**（#981 で学んだ形）。
describe("枝と知らせの数え方", () => {
  it("画面まるごとの入れ物を数える", () => {
    const src = `if (a) return (<div className="main-scroll" />);
return (<div className="main-scroll x" />);`;
    expect(branchCounts(src).branches).toBe(2);
  });

  it("一覧を描くコールバックの `return (` は数えない（画面の枝ではない）", () => {
    // ⚠️ ここが**実際に誤って数えた形**＝`map` の中の `return (`。
    const src = `items.map((i) => {
      return (
        <li />
      );
    })`;
    expect(branchCounts(src).branches).toBe(0);
  });

  it("直に置いたバナーも、包む形も数える", () => {
    expect(branchCounts(`<ExportLockBanner onNavigate={n} />`).notices).toBe(1);
    expect(branchCounts(`<ExportLock onNavigate={n}>{x}</ExportLock>`).notices).toBe(1);
  });

  it("コメントの中は数えない（説明文で数が狂わない）", () => {
    expect(branchCounts(`// <ExportLockBanner />\n/* return (\n< */`)).toEqual({ branches: 0, notices: 0 });
  });
});
