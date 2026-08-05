// キー操作を奪ってよいかの共有判定（#701・監査 §7-6）。**日本語の変換中に奪わない**ことを固定する。
import { describe, expect, it } from "vitest";
import { isImeComposing, isTextEntryTarget, shouldIgnoreShortcut } from "./keyboardShortcut";

const key = (over: Partial<KeyboardEvent> & { target?: unknown }): KeyboardEvent =>
  ({ isComposing: false, keyCode: 27, target: null, ...over }) as unknown as KeyboardEvent;

/** 判定に使う所（タグ名・編集可能か）だけを持つ相手。実 DOM を作らずに規則そのものを見る。 */
const el = (over: { tagName: string; isContentEditable?: boolean }): EventTarget => over as unknown as EventTarget;

describe("keyboardShortcut（#701）", () => {
  it("文字を打っている欄では奪わない", () => {
    expect(isTextEntryTarget(el({ tagName: "INPUT" }))).toBe(true);
    expect(isTextEntryTarget(el({ tagName: "TEXTAREA" }))).toBe(true);
    expect(isTextEntryTarget(el({ tagName: "DIV", isContentEditable: true }))).toBe(true);
    expect(isTextEntryTarget(el({ tagName: "BUTTON" }))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });

  it("日本語の変換中は奪わない（Escape は「変換をやめる」なので横取りしない）", () => {
    expect(isImeComposing(key({ isComposing: true }))).toBe(true);
    // 変換中の目印が付かない環境向けの保険（変換中のキーは一律この値になる）。
    expect(isImeComposing(key({ keyCode: 229 }))).toBe(true);
    expect(isImeComposing(key({}))).toBe(false);
  });

  it("どちらかに当てはまれば横取りしない", () => {
    expect(shouldIgnoreShortcut(key({ target: el({ tagName: "INPUT" }) }))).toBe(true);
    expect(shouldIgnoreShortcut(key({ isComposing: true }))).toBe(true);
    expect(shouldIgnoreShortcut(key({ target: el({ tagName: "BUTTON" }) }))).toBe(false);
  });
});
