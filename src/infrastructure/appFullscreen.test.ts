// @vitest-environment jsdom
// アプリの窓を全画面にする口（#1262）。ブラウザ（開発時）の道と、失敗しても投げないことを見る。
import { afterEach, describe, expect, it, vi } from "vitest";
import { onAppFullscreenChange, setAppFullscreen } from "./appFullscreen";

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

describe("onAppFullscreenChange（ブラウザの道）", () => {
  it("全画面の出入りを知らせ、解けば知らせない", async () => {
    let current: Element | null = document.documentElement;
    Object.defineProperty(document, "fullscreenElement", { get: () => current, configurable: true });
    const seen: boolean[] = [];
    const un = await onAppFullscreenChange((on) => seen.push(on));
    current = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(seen).toEqual([false]);
    un();
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(seen, "解いたのに知らせた").toEqual([false]);
  });
});

// ⚠️ **最後の頼みが最後に効く**（#1269 レビュー 🟡）＝続けて押されても古い頼みで終わらない。
describe("setAppFullscreen（続けて頼まれたとき）", () => {
  it("1つ目の途中で逆を頼まれたら、最後は後の頼みになる", async () => {
    let current: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { get: () => current, configurable: true });
    let release: () => void = () => {};
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      value: vi.fn(() => new Promise<void>((r) => { release = () => { current = document.documentElement; r(); }; })),
      configurable: true,
    });
    Object.defineProperty(document, "exitFullscreen", { value: vi.fn(async () => { current = null; }), configurable: true });
    const first = setAppFullscreen(true);
    const second = setAppFullscreen(false); // 1つ目が終わる前に戻す
    await second;
    release();
    await first;
    expect(current, "古い頼み（全画面）が最後に効いた").toBeNull();
  });
});
