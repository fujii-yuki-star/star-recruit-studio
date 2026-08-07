// @vitest-environment jsdom
// キー操作を奪ってよいかの共有判定（#701・監査 §7-6）。**日本語の変換中に奪わない**ことを固定する。
// DOM が要る判定（`activatesOnSpace`/`usesArrowKeys`・#721）を足したので jsdom へ（ADR-0014 の個別切替）。
import { describe, expect, it } from "vitest";
import { activatesOnSpace, isImeComposing, isTextEntryTarget, shouldIgnoreShortcut, usesArrowKeys } from "./keyboardShortcut";

const key = (over: Partial<KeyboardEvent> & { target?: unknown }): KeyboardEvent =>
  ({ isComposing: false, keyCode: 27, target: null, ...over }) as unknown as KeyboardEvent;

/** 判定に使う所（タグ名・編集可能か）だけを持つ相手。実 DOM を作らずに規則そのものを見る。 */
const el = (over: { tagName: string; isContentEditable?: boolean; type?: string }): EventTarget => over as unknown as EventTarget;

describe("keyboardShortcut（#701）", () => {
  it("文字を打っている欄では奪わない", () => {
    expect(isTextEntryTarget(el({ tagName: "INPUT" }))).toBe(true);
    expect(isTextEntryTarget(el({ tagName: "TEXTAREA" }))).toBe(true);
    expect(isTextEntryTarget(el({ tagName: "DIV", isContentEditable: true }))).toBe(true);
    expect(isTextEntryTarget(el({ tagName: "BUTTON" }))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });

  it("スライダーやチェックボックスでは奪わない（文字を打つ場所ではない）", () => {
    // `<input>` は種類で意味が違う。再生位置のスライダーを触った直後にキー操作が黙って死ぬ、を防ぐ。
    expect(isTextEntryTarget(el({ tagName: "INPUT", type: "range" }))).toBe(false);
    expect(isTextEntryTarget(el({ tagName: "INPUT", type: "checkbox" }))).toBe(false);
    expect(isTextEntryTarget(el({ tagName: "INPUT", type: "number" }))).toBe(true);
    expect(isTextEntryTarget(el({ tagName: "INPUT" }))).toBe(true); // 種類なし＝既定は text
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

// キーを譲る判定（#721）。`Space`＝再生／停止、矢印＝再生位置に使うので、
// **その要素自身がそのキーで反応するときは奪わない**（奪うと画面じゅうの操作がキーボードで死ぬ）。
describe('activatesOnSpace / usesArrowKeys（そのキーは要素のものか）', () => {
  const el = (html: string): HTMLElement => {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild as HTMLElement;
  };

  it('Space：ボタン・セレクト・summary・押せる input・role は譲る', () => {
    expect(activatesOnSpace(el('<button>x</button>'))).toBe(true);
    expect(activatesOnSpace(el('<select><option>a</option></select>'))).toBe(true);
    expect(activatesOnSpace(el('<summary>x</summary>'))).toBe(true);
    expect(activatesOnSpace(el('<input type="checkbox">'))).toBe(true);
    expect(activatesOnSpace(el('<input type="radio">'))).toBe(true);
    expect(activatesOnSpace(el('<div role="button" tabindex="0">x</div>'))).toBe(true);
    expect(activatesOnSpace(el('<div role="switch" tabindex="0">x</div>'))).toBe(true);
  });

  it('Space：奪ってよい相手（本文・スライダー・素の div・要素でないもの）', () => {
    expect(activatesOnSpace(el('<div>x</div>'))).toBe(false);
    expect(activatesOnSpace(el('<input type="range">'))).toBe(false); // Space では動かない
    expect(activatesOnSpace(el('<div role="presentation">x</div>'))).toBe(false);
    expect(activatesOnSpace(null)).toBe(false);
    expect(activatesOnSpace(window)).toBe(false); // `tagName` を持たない相手（キーが本文へ来たとき）
  });

  it('矢印：セレクト・スライダー・数値欄・ラジオ・role は譲る', () => {
    expect(usesArrowKeys(el('<select><option>a</option></select>'))).toBe(true);
    expect(usesArrowKeys(el('<input type="range">'))).toBe(true);
    expect(usesArrowKeys(el('<input type="number">'))).toBe(true);
    expect(usesArrowKeys(el('<input type="radio">'))).toBe(true);
    expect(usesArrowKeys(el('<div role="slider" tabindex="0">x</div>'))).toBe(true);
    expect(usesArrowKeys(el('<div role="combobox" tabindex="0">x</div>'))).toBe(true);
  });

  it('矢印：奪ってよい相手（ボタン・チェック・素の div・要素でないもの）', () => {
    expect(usesArrowKeys(el('<button>x</button>'))).toBe(false); // 押すだけ＝矢印は使わない
    expect(usesArrowKeys(el('<input type="checkbox">'))).toBe(false);
    expect(usesArrowKeys(el('<div>x</div>'))).toBe(false);
    expect(usesArrowKeys(null)).toBe(false);
    expect(usesArrowKeys(window)).toBe(false);
  });
});
