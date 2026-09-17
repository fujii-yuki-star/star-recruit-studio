// @vitest-environment jsdom
// 文字キーで中を探す相手から、画面のキーを奪わない（#1193・PR #1199 レビュー 🟡）。
//
// ⚠️ **`<select>` は文字キーで選択肢へ飛ぶ**（ブラウザの標準機能）＝`I`／`O` を一律で奪うと、
// 「Inter」「Open…」のような選択肢へ**飛べなくなる**。矢印キーを `usesArrowKeys` で譲っているのと同じ話。
import { describe, expect, it } from 'vitest';
import { usesTypeAhead } from './keyboardShortcut';

const el = (tag: string, role?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (role) e.setAttribute('role', role);
  return e;
};

describe('文字で中を探す相手か', () => {
  it('選ぶ欄は、譲る', () => {
    expect(usesTypeAhead(el('select'))).toBe(true);
  });

  it('中身を文字で絞る役割も、譲る', () => {
    for (const role of ['listbox', 'combobox', 'menu', 'menuitem', 'tree', 'treeitem']) {
      expect(usesTypeAhead(el('div', role)), role).toBe(true);
    }
  });

  // ⚠️ **押すだけのものからは奪ってよい**＝ボタンは文字キーで中を探さない。
  it('ボタンや素の要素からは、奪ってよい', () => {
    expect(usesTypeAhead(el('button'))).toBe(false);
    expect(usesTypeAhead(el('div'))).toBe(false);
    expect(usesTypeAhead(el('div', 'button'))).toBe(false);
  });

  it('相手が無くても落ちない', () => {
    expect(usesTypeAhead(null)).toBe(false);
  });
});
