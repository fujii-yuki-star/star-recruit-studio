// 焼き出しの断りは、**そのまま画面に出る**（#1123・PR #1130 レビュー由来 🟡）。
//
// ⚠️ **以前は出なかった**＝書き出しの受け口が `typeof e === "string"` で `Error` を落としていたので、
// 次の行動つきの既定文（`EXPORT_FAILED_TIMELINE`）が出ていた。関門（`userFacingMessage`）は
// **`Error` の `message` も読む**ので、いまは**日本語＋句点の文がそのまま出る**。
// ⚠️ **だから「原因だけの1文」を置かない**＝置くと、次の行動つきの既定文を**追い出す**（§2-5）。
//
// ⚠️ **`uiMessageScan` の射程外**＝あちらが歩くのは `src/app` と `src/infrastructure` だけで、
// `src/renderer` は見ていない。ここが**この file の存在理由**（射程の外にある画面の文を留める）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { showsNextAction } from "../../test/nextAction";

const src = readFileSync(join(process.cwd(), "src/renderer/export/rasterize.ts"), "utf8");

/** `throw new Error('…')` / `new Error('…')` に書いた文を拾う（注記は除く）。 */
export function thrownMessages(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .flatMap((line) => [...line.matchAll(/new Error\(\s*'([^']+)'/g)].map((m) => m[1]!));
}

describe("焼き出しの断りは、次の行動を示す（#1123）", () => {
  const messages = thrownMessages(src);

  it("走査が空振りしていない（拾えていないのに緑、を作らない）", () => {
    expect(messages.length, "断りを1つも拾えていない＝拾い方が壊れている").toBe(3);
  });

  it("どれも次の行動で終わる（§2-5）", () => {
    const without = messages.filter((m) => !showsNextAction(m));
    expect(without, "原因だけの1文は、次の行動つきの既定文を追い出す").toEqual([]);
  });

  it("どれも句点を持つ（持たないと関門で落ち、利用者に届かない）", () => {
    expect(messages.filter((m) => !m.includes("。"))).toEqual([]);
  });
});

describe("拾い方そのものの検査（わざと壊した入力）", () => {
  it("投げている文を拾う", () => {
    expect(thrownMessages("throw new Error('あ。');")).toEqual(["あ。"]);
    expect(thrownMessages("reject(new Error('い。'))")).toEqual(["い。"]);
  });

  it("注記の中の形では拾わない（誤検出は門番の信用を落とす）", () => {
    expect(thrownMessages("// new Error('あ。') は書かない")).toEqual([]);
    expect(thrownMessages(" * `new Error('あ。')` の話")).toEqual([]);
  });
});
