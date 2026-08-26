// `15 §6`（エラーコード表）の**利用者に出す文言**が、実装の文字列と一致していることを機械で守る（#855）。
//
// ⚠️ **目視では6回すり抜けた**＝挙動と正典を直したのに表だけ古いまま、が繰り返し起きている
// （直近は PR #854＝「正典と実装のズレを消す」PR 自身が同じズレを作っていた）。
// 既存の `uiLabels.test.ts` の走査は **§2-3 の禁止語**しか見ておらず、**文言そのものの一致は対象外**
// だったので、機械層は緑のまま通っていた。ここがその穴を塞ぐ。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bakeNoteMessage, editBlockedMessage, exportBlockedMessage } from "./uiLabels";
import { EXPORT_CLEANUP_PENDING_MESSAGE, OTHER_EXPORT_RUNNING_MESSAGE } from "./store/exportLock";

/** `15 §6` の表：コード → 「ユーザー向け文言」の列（4列目）。 */
function readErrorTable(): Map<string, string> {
  const md = readFileSync(join(process.cwd(), "docs/yuko_recruit_docs/15_ERROR_STATE_MODEL.md"), "utf8");
  const rows = new Map<string, string>();
  for (const line of md.split("\n")) {
    const m = /^\| `([A-Z_]+)` \|/.exec(line);
    if (!m) continue;
    const cells = line.split("|");
    // | code | severity | 既定の自動対応 | ユーザー向け文言 | 由来 |  → 文言は index 4
    if (cells.length < 5) continue;
    rows.set(m[1], (cells[4] ?? "").trim());
  }
  return rows;
}

/**
 * コード側の「表と1対1で結べる」文言。
 *
 * ⚠️ **締めが状況で変わる文は入れない**＝`lockedTrackMessage`（動かす/中身/削除）・
 * `volumePointsTooManyMessage`（分けられる部品の有無）・`missingTemplateMessage`（件数）・
 * `hiddenTrackDuplicateMessage` は**1つの表の行に対して複数の文**を返すので、等値では守れない。
 * それらは `uiLabels.test.ts` の禁止語走査が引き続き見ている（守り方が違うだけで対象外ではない）。
 */
function codeMessages(): Record<string, string> {
  return {
    ...editBlockedMessage,
    ...exportBlockedMessage,
    ...bakeNoteMessage,
    EXPORT_CLEANUP_PENDING: EXPORT_CLEANUP_PENDING_MESSAGE,
    EXPORT_OTHER_RUNNING: OTHER_EXPORT_RUNNING_MESSAGE,
  };
}

/** 表は文末の「。」を落とす流儀（`EXPORT_OTHER_RUNNING` ほか既存行がすべてこの形）。 */
const norm = (s: string): string => s.replace(/。$/, "").trim();

describe("15 §6 の表と実装の一致（#855）", () => {
  it("表の文言と実装の文字列が一致する（片方だけ直したら落ちる）", () => {
    const rows = readErrorTable();
    const mismatched: string[] = [];
    for (const [code, message] of Object.entries(codeMessages())) {
      const cell = rows.get(code);
      if (cell == null) continue; // 表に無い件は次のテストが見る
      if (norm(cell) !== norm(message)) {
        mismatched.push(`${code}\n  表  : ${cell}\n  実装: ${message}`);
      }
    }
    // ⚠️ **どちらが新しいかは機械には分からない**ので、両方を並べて出す（直す先を人が決める）。
    expect(mismatched.join("\n\n")).toBe("");
  });

  it("実装にある文言は、必ず表にも行がある（足したのに正典へ書き忘れたら落ちる）", () => {
    const rows = readErrorTable();
    const missing = Object.keys(codeMessages()).filter((code) => !rows.has(code));
    expect(missing).toEqual([]);
  });

  it("守れている件数が黙って減らない（対象の families を外すと落ちる）", () => {
    // ⚠️ 件数そのものを固定したいのではなく、**上の2つが空振りする状態**（対象が消えた・
    // 表の読み取りが壊れた）を検知したい。増えるぶんには構わないので下限で見る。
    const rows = readErrorTable();
    expect(rows.size).toBeGreaterThanOrEqual(80);
    expect(Object.keys(codeMessages()).length).toBeGreaterThanOrEqual(36);
  });
});
