// @vitest-environment jsdom
// 端送りの時計まわり（#714-1）。速さの規則は domain（`autoScroll.test.ts`）、ここは
// **止め方**と**送った分をやり直すか**を見る（掴んだまま放置しても回り続けない・落ちる先が追いつく）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useEdgeAutoScroll } from "./useEdgeAutoScroll";

/** rAF を手で進める（実時間を待たない）。 */
function fakeRaf() {
  let queue: Array<(t: number) => void> = [];
  let now = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { queue.push(cb); return queue.length; });
  vi.stubGlobal("cancelAnimationFrame", () => { queue = []; });
  vi.stubGlobal("performance", { now: () => now });
  return {
    tick(ms: number) {
      now += ms;
      const run = queue;
      queue = [];
      act(() => { run.forEach((cb) => cb(now)); });
    },
    get pending() { return queue.length; },
  };
}

/** 横に送れる枠（jsdom は実寸を持たないので必要な値だけ持たせる）。 */
function scrollBox(over: { scrollWidth?: number; clientWidth?: number } = {}): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: over.clientWidth ?? 800, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: over.scrollWidth ?? 3000, configurable: true });
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 100, width: 800, height: 100, x: 0, y: 0, toJSON: () => ({}) });
  return el;
}

/** 枠の縦の内側（0〜100）を既定にする＝横の話だけを見たいテスト用。 */
const pointerAt = (clientX: number) => ({ clientX, clientY: 50 }) as PointerEvent;

let raf: ReturnType<typeof fakeRaf>;
beforeEach(() => { raf = fakeRaf(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("useEdgeAutoScroll（掴んだまま端まで来たら送る・#714）", () => {
  it("真ん中では時計を回さない（掴んでいるだけで毎フレーム走らせない）", () => {
    const { result } = renderHook(() => useEdgeAutoScroll());
    const el = scrollBox();
    act(() => { result.current.track(el, pointerAt(400), vi.fn()); });
    expect(raf.pending).toBe(0);
  });

  it("端まで来たら送り、送った分で**やり直す**（落ちる先が追いつく）", () => {
    const { result } = renderHook(() => useEdgeAutoScroll());
    const el = scrollBox();
    const replay = vi.fn();
    act(() => { result.current.track(el, pointerAt(799), replay); });
    raf.tick(100);
    expect(el.scrollLeft).toBeGreaterThan(0);
    expect(replay).toHaveBeenCalled(); // 指は止まっているが落ちる先は動く
  });

  it("行き止まりでは送らない・やり直さない（同じ絵で回し続けない）", () => {
    const { result } = renderHook(() => useEdgeAutoScroll());
    const el = scrollBox({ scrollWidth: 800 }); // 送る余地なし
    const replay = vi.fn();
    act(() => { result.current.track(el, pointerAt(799), replay); });
    raf.tick(100);
    expect(el.scrollLeft).toBe(0);
    expect(replay).not.toHaveBeenCalled();
  });

  it("端から離れたら止まる（帯の外へ戻したのに送り続けない）", () => {
    const { result } = renderHook(() => useEdgeAutoScroll());
    const el = scrollBox();
    act(() => { result.current.track(el, pointerAt(799), vi.fn()); });
    raf.tick(50);
    act(() => { result.current.track(el, pointerAt(400), vi.fn()); }); // 真ん中へ戻した
    const at = el.scrollLeft;
    raf.tick(200);
    expect(el.scrollLeft).toBe(at);
    // ⚠️ 送る量が 0 になるだけでは足りない＝**時計を止める**（掴んでいる間ずっと毎フレーム回さない）。
    expect(raf.pending).toBe(0);
  });

  it("`stop` で止まる（離した・やめた後に動かない）", () => {
    const { result } = renderHook(() => useEdgeAutoScroll());
    const el = scrollBox();
    act(() => { result.current.track(el, pointerAt(799), vi.fn()); });
    raf.tick(50);
    act(() => { result.current.stop(); });
    const at = el.scrollLeft;
    raf.tick(200);
    expect(el.scrollLeft).toBe(at);
  });

  it("画面を離れたら止まる（掴んだまま別の画面へ行っても回り続けない）", () => {
    const { result, unmount } = renderHook(() => useEdgeAutoScroll());
    const el = scrollBox();
    act(() => { result.current.track(el, pointerAt(799), vi.fn()); });
    raf.tick(50);
    unmount();
    const at = el.scrollLeft;
    raf.tick(200);
    expect(el.scrollLeft).toBe(at);
  });

  it("指が枠の**縦の外**なら送らない（タイムラインの上に無いのに流れない）", () => {
    // ⚠️ 横だけで見ると、左の「置く」欄と枠が同じ左端から始まるので**一覧を掴んだ瞬間に**
    // 送る帯に入り、落とし先も予告も無いまま最大の速さで先頭へ巻き戻る（レビューで2名が独立に指摘）。
    const { result } = renderHook(() => useEdgeAutoScroll());
    const el = scrollBox();
    act(() => { result.current.track(el, { clientX: 799, clientY: 500 } as PointerEvent, vi.fn()); }); // 枠は 0〜100
    expect(raf.pending).toBe(0);
  });

  it("枠が無くなったら止める（外れた要素を見て回り続けない）", () => {
    const { result } = renderHook(() => useEdgeAutoScroll());
    const el = scrollBox();
    act(() => { result.current.track(el, pointerAt(799), vi.fn()); });
    raf.tick(50);
    const at = el.scrollLeft;
    act(() => { result.current.track(null, pointerAt(799), vi.fn()); });
    raf.tick(200);
    expect(el.scrollLeft).toBe(at);
    expect(raf.pending).toBe(0);
  });

  it("枠が無いときは何もしない（掴めるが送り先が無い場面で落ちない）", () => {
    const { result } = renderHook(() => useEdgeAutoScroll());
    act(() => { result.current.track(null, pointerAt(799), vi.fn()); });
    expect(raf.pending).toBe(0);
  });
});
