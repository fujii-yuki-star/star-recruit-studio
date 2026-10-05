// @vitest-environment jsdom
// `Space` を焦点のあるボタンへ譲るか（UI/UX 監査 2026-10-02・PR4a）。画面に依らない規則だけを見る。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { resetSpaceFocusForTest, useSpaceFocusTracking, yieldsSpaceTo } from "./spaceFocus";

function Host() {
  useSpaceFocusTracking();
  return null;
}

let cleanup: (() => void) | null = null;
const make = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  return el;
};

beforeEach(() => {
  resetSpaceFocusForTest();
  cleanup = render(createElement(Host)).unmount;
});
afterEach(() => {
  cleanup?.();
  document.body.innerHTML = "";
});

describe("yieldsSpaceTo", () => {
  it("Space で反応しない要素には譲らない", () => {
    expect(yieldsSpaceTo(make("div"))).toBe(false);
    expect(yieldsSpaceTo(null)).toBe(false);
  });

  it("焦点の来方が分からないボタンには、これまでどおり譲る", () => {
    expect(yieldsSpaceTo(make("button"))).toBe(true);
  });

  it("マウスの後に焦点が来たボタンには譲らない・キーの後なら譲る", () => {
    const b = make("button");
    fireEvent.pointerDown(b);
    b.focus();
    expect(yieldsSpaceTo(b)).toBe(false);
    fireEvent.keyDown(window, { key: "Tab" });
    b.blur();
    b.focus();
    expect(yieldsSpaceTo(b)).toBe(true);
  });

  it("選ぶ欄・チェックはマウスで触っても譲る（そこでの Space は選ぶ操作）", () => {
    const sel = make("select");
    fireEvent.pointerDown(sel);
    sel.focus();
    expect(yieldsSpaceTo(sel)).toBe(true);
    const cb = make("input");
    cb.type = "checkbox";
    fireEvent.pointerDown(cb);
    cb.focus();
    expect(yieldsSpaceTo(cb)).toBe(true);
  });

  it("役割だけのボタン（role=button・switch）も、マウスの後なら譲らない", () => {
    for (const role of ["button", "switch"]) {
      const el = make("div");
      el.setAttribute("role", role);
      el.tabIndex = 0;
      fireEvent.pointerDown(el);
      el.focus();
      expect(yieldsSpaceTo(el), role).toBe(false);
    }
  });

  it("見張りを外したら覚えない（画面を閉じたあとに残らない）", () => {
    cleanup?.();
    cleanup = null;
    const b = make("button");
    fireEvent.pointerDown(b);
    b.focus();
    expect(yieldsSpaceTo(b)).toBe(true);
  });
});
