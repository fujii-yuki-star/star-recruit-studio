// 起動の引数で返す断り・知らせの文は `[` で始まらない（通し点検 2026-10-16・`18 §18.5`）。
//
// ⚠️ **外の AI が行を見分ける唯一の手がかり**＝標準エラーには WebView2 が閉じるときの `[…:ERROR:…]` の行や、
// 開発版の記録の行（`[voicevox]` など）が混ざる。18 は「断り・知らせの文は `[` で始まらない」と約束しているので、
// 文を足したときに崩れたら赤くする（書いた約束を守らせる門＝CLAUDE.md §7）。
import { describe, expect, it } from "vitest";
import * as startupJob from "./useStartupJob";
import {
  importDoneMessage, makeVoicesDoneMessage, startupArgErrorMessage, startupExportNotes,
} from "../../domain/startup/startupMessages";

describe("起動の引数の断り・知らせは `[` で始まらない（18 §18.5）", () => {
  const constants = Object.entries(startupJob).filter(([k, v]) => k.startsWith("STARTUP_") && typeof v === "string") as [string, string][];

  it("断りの文（定数）を数えて、全部見る", () => {
    // ⚠️ **実数で留める**＝走査が空振りして緑になるのを防ぐ（足したら数も直す）。
    expect(constants.length).toBe(7);
    for (const [k, v] of constants) expect(v.startsWith("["), k).toBe(false);
  });

  it("組み立てる文（引数の誤り・取り込み・声・書き出しの注意）", () => {
    const lines = [
      startupArgErrorMessage({ kind: "unknown", flag: "--exprot" }),
      startupArgErrorMessage({ kind: "missingValue", flag: "--out" }),
      startupArgErrorMessage({ kind: "incompleteExport", flag: null }),
      startupArgErrorMessage({ kind: "conflicting", flag: null }),
      importDoneMessage(9, 0),
      importDoneMessage(9, 2),
      makeVoicesDoneMessage(0),
      makeVoicesDoneMessage(3),
      ...(startupExportNotes([{ label: "切れている文字", detail: "…" }]) ?? "").split("\n"),
    ];
    for (const l of lines) expect(l.startsWith("["), l).toBe(false);
  });
});
