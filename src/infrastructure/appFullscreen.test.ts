// @vitest-environment jsdom
// アプリの窓を全画面にする口（#1262）。ブラウザ（開発時）の道と、失敗しても投げないことを見る。
import { afterEach, describe, expect, it, vi } from "vitest";
import { setAppFullscreen } from "./appFullscreen";

afterEach(() => vi.restoreAllMocks());

describe("setAppFullscreen（ブラウザの道）", () => {
  it("全画面にする／戻す", async () => {
    const req = vi.fn(async () => {});
    const exit = vi.fn(async () => {});
    Object.defineProperty(document.documentElement, "requestFullscreen", { value: req, configurable: true });
    Object.defineProperty(document, "exitFullscreen", { value: exit, configurable: true });
    let current: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { get: () => current, configurable: true });
    expect(await setAppFullscreen(true)).toBe(true);
    expect(req).toHaveBeenCalled();
    current = document.documentElement;
    expect(await setAppFullscreen(false)).toBe(true);
    expect(exit).toHaveBeenCalled();
  });

  // ⚠️ **失敗しても画面を壊さない**＝全画面にならないだけ（欄を広げる方は効いている）。
  it("失敗したら false を返し、投げない", async () => {
    Object.defineProperty(document, "fullscreenElement", { get: () => null, configurable: true });
    Object.defineProperty(document.documentElement, "requestFullscreen", { value: vi.fn(async () => { throw new Error("拒否"); }), configurable: true });
    await expect(setAppFullscreen(true)).resolves.toBe(false);
  });
});
