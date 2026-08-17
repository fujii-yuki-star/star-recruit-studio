// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useDragReorder } from "./useDragReorder";

// Pointer Events 版（#398 再対応）。button 直掛けだと HTML5 dragstart が発火しなかったため置換。
// handle の pointerdown で開始→落下先の pointermove で重なり位置→window の pointerup で確定、を実イベントで検証する。
const mkDown = (button = 0) => ({ button, preventDefault: vi.fn() }) as unknown as ReactPointerEvent;
/**
 * 落下先の上での移動。**要素の半分より手前か後ろか**ですき間が決まる（#771(c)）ので、
 * 実寸（`getBoundingClientRect`）と指の位置を渡す。`after` で後ろ半分を指す。
 */
const mkMove = (after = false) => ({
  clientX: after ? 80 : 20,
  clientY: after ? 80 : 20,
  currentTarget: {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
  },
}) as unknown as ReactPointerEvent;

describe("useDragReorder（Pointer Events 並び替え・#398）", () => {
  it("pointerdown→すき間 pointermove→window pointerup で onReorder(fromId, 入れる位置) を呼び解除する", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    const down = mkDown();
    act(() => result.current.handleProps("scene_001", 0).onPointerDown(down));
    expect(result.current.draggingId).toBe("scene_001");
    expect(down.preventDefault).toHaveBeenCalled(); // ドラッグ中のテキスト選択抑止
    act(() => result.current.dropProps(2).onPointerMove(mkMove()));
    expect(result.current.overGap).toBe(2); // 2番目の手前のすき間
    act(() => {
      window.dispatchEvent(new Event("pointerup")); // 要素外で離しても window で拾う
    });
    // すき間2 は 0番目から見て「後ろ」なので、抜いた後の位置は1つ手前＝1（`insertIndexForGap`）。
    expect(onReorder).toHaveBeenCalledWith("scene_001", 1);
    expect(result.current.draggingId).toBeNull();
    expect(result.current.overGap).toBeNull();
  });

  it("ドラッグ中でないときの pointermove はすき間を変えない（通常のマウス移動を拾わない）", () => {
    const { result } = renderHook(() => useDragReorder(vi.fn()));
    act(() => result.current.dropProps(1).onPointerMove(mkMove()));
    expect(result.current.overGap).toBeNull();
  });

  it("どの落下先にも重ならず離した（すき間 無し）ときは onReorder を呼ばない＝クリック相当", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    act(() => result.current.handleProps("s1", 0).onPointerDown(mkDown()));
    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });
    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.draggingId).toBeNull();
  });

  it("主ボタン以外（右クリック等）の pointerdown は無視する", () => {
    const { result } = renderHook(() => useDragReorder(vi.fn()));
    const e = mkDown(2);
    act(() => result.current.handleProps("s1", 0).onPointerDown(e));
    expect(result.current.draggingId).toBeNull();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("pointercancel は中断＝重なり位置があっても onReorder を呼ばず状態だけ戻す", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    act(() => result.current.handleProps("s1", 0).onPointerDown(mkDown()));
    act(() => result.current.dropProps(1).onPointerMove(mkMove()));
    expect(result.current.overGap).toBe(1); // すき間はあった
    act(() => {
      window.dispatchEvent(new Event("pointercancel"));
    });
    expect(onReorder).not.toHaveBeenCalled(); // 中断なので並べ替えない
    expect(result.current.draggingId).toBeNull();
    expect(result.current.overGap).toBeNull();
  });

  // #771(c)：**半分より後ろを指したら「その後ろのすき間」**＝同じ手つきが向きで別の意味にならない。
  it("要素の後ろ半分を指すと、後ろのすき間になる", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    act(() => result.current.handleProps("s1", 0).onPointerDown(mkDown()));
    act(() => result.current.dropProps(2).onPointerMove(mkMove(true)));
    expect(result.current.overGap).toBe(3); // 2番目の**後ろ**
    act(() => { window.dispatchEvent(new Event("pointerup")); });
    expect(onReorder).toHaveBeenCalledWith("s1", 2); // 抜いた後の位置
  });

  it("横並びのときは左右で決める（縦の位置では変わらない）", () => {
    const { result } = renderHook(() => useDragReorder(vi.fn(), { axis: "x" }));
    act(() => result.current.handleProps("s1", 0).onPointerDown(mkDown()));
    // 右半分＝後ろのすき間（縦は手前を指していても左右で決まる）。
    act(() => result.current.dropProps(1).onPointerMove(
      ({ clientX: 80, clientY: 20, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }) } }) as unknown as ReactPointerEvent,
    ));
    expect(result.current.overGap).toBe(2);
  });
});
