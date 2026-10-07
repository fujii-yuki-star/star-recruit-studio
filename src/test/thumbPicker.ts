// 「見て選ぶ」格子ピッカー（`ThumbPicker`・#1031）を対話テストから動かすヘルパー。
//
// ⚠️ **開き方とタイルの引き方を各テストへ写さない**＝名前の `<select>` だった頃は
// `fireEvent.change` の一行で済んでいた。押して開く形になった以上、駆動を1か所へ寄せておかないと
// 「ここだけ古い開き方」が残る（実際に、置き換えた瞬間に17件が同時に落ちた）。
// ⚠️ **候補は呼び名（`aria-label`）で見分ける**＝タイルの中身には見本の絵（SVG）が入っていて、
// 見出しの例文まで文字として読めてしまうので、`textContent` で引くと別の候補に当たる。
import { fireEvent } from "@testing-library/react";

/**
 * 見出しの文言から、それが指しているピッカーの「開く」ボタンを引く。
 *
 * ⚠️ **`htmlFor` をたどる**＝見出しと欄が結ばれていること自体もここで確かめる（#1075）。
 */
export function pickerOf(root: ParentNode, label: string): HTMLButtonElement {
  const el = [...root.querySelectorAll("label")].find((l) => l.textContent === label);
  if (!el) throw new Error(`見出し「${label}」が無い`);
  const field = root.querySelector(`#${CSS.escape(el.htmlFor)}`);
  if (!field) throw new Error(`見出し「${label}」が欄と結ばれていない`);
  return field as HTMLButtonElement;
}

/** いま開いている格子の候補タイル。 */
export function pickerTiles(root: ParentNode): HTMLButtonElement[] {
  return [...root.querySelectorAll("[aria-expanded='true']")].flatMap(
    (btn) => [...(btn.parentElement?.querySelectorAll("button[aria-label]") ?? [])],
  ) as HTMLButtonElement[];
}

/** 見出し `label` のピッカーを開いて、候補の呼び名を並べる（並びは画面の並び）。 */
export function pickerOptions(root: ParentNode, label: string): string[] {
  const trigger = pickerOf(root, label);
  const wasOpen = trigger.getAttribute("aria-expanded") === "true";
  if (!wasOpen) fireEvent.click(trigger);
  const names = pickerTiles(root).map((b) => b.getAttribute("aria-label") ?? "");
  if (!wasOpen) fireEvent.click(trigger);
  return names;
}

/** 見出し `label` のピッカーを開いて、呼び名が `name` の候補を押す。 */
export function pick(root: ParentNode, label: string, name: string): void {
  const trigger = pickerOf(root, label);
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  const tile = pickerTiles(root).find((b) => b.getAttribute("aria-label") === name);
  if (!tile) {
    const seen = pickerTiles(root).map((b) => b.getAttribute("aria-label")).join(" / ");
    throw new Error(`「${label}」の候補に「${name}」が無い（出ているのは ${seen}）`);
  }
  fireEvent.click(tile);
}
