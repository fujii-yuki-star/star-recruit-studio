// 戻る導線の文言の門番（`06 §2` 規約3・規約11／#1026）。
//
// ⚠️ **文言ごとに書き並べる検査では、直し漏れた1か所を構造的に見つけられない**（#1027）ので、
// **画面をまるごと歩いて**「行き先名を言わない戻る」と「一覧の呼び名の直書き」を探す。
//
// ⚠️ **2つとも実際に残っていた**（2026-09-14）＝ウィザードの戻るは行き先名の無い「戻る」で、
// しかも**段によって行き先が変わる**（1つ前の段／いちばん最初は一覧）ので、押すまで行き先が
// 分からなかった。タイムラインの「動画の一覧へ」は `BACK_TO_HOME_LABEL` を通らない**直書き**で、
// 同じ行き先が2つの言い方に割れていた（`06 §2` 規約9 が「まだ揃っていない」と但し書きしていた借り）。
//
// ⚠️ **拾い方は共有する**（`screenTextsIn`）＝コメントの外し方を書き写すと、
// 片方だけ緩めてももう片方は黙って通し続ける（`oneJapaneseMatcherGuard` と同じ型）。
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { screenTextsIn } from "./uiTerms";
import { BACK_TO_HOME_LABEL, HOME_SCREEN_LABEL } from "../app/uiLabels";

/** 一覧の行き先名（定義元だけが直書きしてよい）。 */
export const HOME_LIST_LABELS = [
  `${HOME_SCREEN_LABEL}の一覧へ`,
  `${HOME_SCREEN_LABEL}の一覧へ戻る`,
] as const;

/** 定義元（ここは直書きしてよい＝ここが単一の参照元）。 */
const DEFINES_LABELS = "src/app/uiLabels.ts";

/**
 * 行き先名を言わない戻る（`06 §2` 規約3＝「◯◯へ戻る」）。
 *
 * ⚠️ **「◯◯へ戻る」は通す**＝行き先名が付いていれば規約どおり。見るのは「戻る」**だけ**の文言。
 */
export function bareBackLabels(texts: readonly string[]): string[] {
  return texts.filter((t) => t === "戻る");
}

/** 一覧の行き先名を直書きしている文言。 */
export function hardCodedHomeLabels(texts: readonly string[]): string[] {
  return texts.filter((t) => (HOME_LIST_LABELS as readonly string[]).includes(t));
}

function appScreens(): { path: string; texts: string[] }[] {
  const root = process.cwd();
  const walk = (dir: string): { path: string; texts: string[] }[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) return [];
      return [
        {
          path: relative(root, p).split(sep).join("/"),
          texts: screenTextsIn(readFileSync(p, "utf8")),
        },
      ];
    });
  return walk(join(root, "src", "app"));
}

describe("戻る導線の文言（#1026・`06 §2` 規約3／規約11）", () => {
  it("一覧への戻るは「◯◯へ戻る」の形をしている（定数そのものを留める）", () => {
    // ⚠️ **消費側を数えるだけでは足りない**（#1141 レビュー由来 🟡）＝画面も検査も
    // **同じ定数**を見ているので、定数の中身を「動画の一覧へ」に戻すと**全部が一緒に動いて緑**になる。
    // 守られるのは「単一の参照元からズレていないか」だけで、**規約3 の形**は誰も見ていなかった。
    // ⚠️ **言葉選びまでは縛らない**＝縛るのは形（「へ戻る」で終わる）と、行き先名が入っていること。
    expect(
      BACK_TO_HOME_LABEL.endsWith("へ戻る"),
      "一覧への戻るが「◯◯へ戻る」の形ではありません（`06 §2` 規約3）",
    ).toBe(true);
    expect(
      BACK_TO_HOME_LABEL.includes(HOME_SCREEN_LABEL),
      "行き先の名前が入っていません（どこへ出るのか分からない）",
    ).toBe(true);
  });

  it("走査が空振りしていない（画面を拾えている）", () => {
    // ⚠️ **実数で留める**＝根を取り違えると「0 件だから緑」になる（`guards-blind-not-red`）。
    const files = appScreens();
    expect(files.length, "走査の根が変わりました（`src/app` を歩けていません）").toBeGreaterThan(100);
    const wizard = files.find(({ path }) => path === "src/app/screens/WizardScreen.tsx");
    expect(wizard, "ウィザードを拾えていません").toBeDefined();
    expect(wizard!.texts.length, "ウィザードの文言を拾えていません").toBeGreaterThan(10);
  });

  it("行き先名を言わない「戻る」は、どの画面にも無い", () => {
    const found = appScreens()
      .filter(({ texts }) => bareBackLabels(texts).length > 0)
      .map(({ path }) => path)
      .sort();
    expect(
      found,
      "行き先名の無い「戻る」があります。`06 §2` 規約3＝「◯◯へ戻る」にしてください",
    ).toEqual([]);
  });

  it("一覧の行き先名は、定義元の外に直書きされていない", () => {
    const found = appScreens()
      .filter(({ path, texts }) => path !== DEFINES_LABELS && hardCodedHomeLabels(texts).length > 0)
      .map(({ path }) => path)
      .sort();
    expect(
      found,
      "一覧の行き先名の直書きがあります。`BACK_TO_HOME_LABEL` から採ってください（`06 §2` 規約11）",
    ).toEqual([]);
  });

  it("拾い方そのものを叩く（歩くだけの走査にしない）", () => {
    expect(bareBackLabels(["戻る"])).toEqual(["戻る"]);
    expect(bareBackLabels(["一覧へ戻る", "台本表へ戻る"])).toEqual([]);
    // ⚠️ **文の中の「戻る」は拾わない**＝案内文まで赤くすると門番の信用が落ちる。
    expect(bareBackLabels(["前の画面へ戻ると入力は消えます。"])).toEqual([]);
    expect(hardCodedHomeLabels([`${HOME_SCREEN_LABEL}の一覧へ`])).toHaveLength(1);
    expect(hardCodedHomeLabels([`${HOME_SCREEN_LABEL}の一覧へ戻る`])).toHaveLength(1);
    // ⚠️ **同じ語を含むだけの文は拾わない**＝「保存した動画の一覧を読み込めませんでした。」は断りの文。
    expect(hardCodedHomeLabels([`保存した${HOME_SCREEN_LABEL}の一覧を読み込めませんでした。`])).toEqual([]);
  });
});
