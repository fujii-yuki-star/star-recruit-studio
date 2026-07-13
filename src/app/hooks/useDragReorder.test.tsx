// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useDragReorder } from "./useDragReorder";

// Pointer Events 版（#398 再対応）。button 直掛けだと HTML5 dragstart が発火しなかったため置換。
// handle の pointerdown で開始→落下先の pointermove で重なり位置→window の pointerup で確定、を実イベントで検証する。
const mkDown = (button = 0) => ({ button, preventDefault: vi.fn() }) as unknown as ReactPointerEvent;
const mkMove = () => ({}) as unknown as ReactPointerEvent;

describe("useDragReorder（Pointer Events 並び替え・#398）", () => {
  it("pointerdown→重なり pointermove→window pointerup で onReorder(fromId, overIndex) を呼び解除する", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    const down = mkDown();
    act(() => result.current.handleProps("scene_001").onPointerDown(down));
    expect(result.current.draggingId).toBe("scene_001");
    expect(down.preventDefault).toHaveBeenCalled(); // ドラッグ中のテキスト選択抑止
    act(() => result.current.dropProps(2).onPointerMove(mkMove()));
    expect(result.current.overIndex).toBe(2);
    act(() => {
      window.dispatchEvent(new Event("pointerup")); // 要素外で離しても window で拾う
    });
    expect(onReorder).toHaveBeenCalledWith("scene_001", 2);
    expect(result.current.draggingId).toBeNull();
    expect(result.current.overIndex).toBeNull();
  });

  it("ドラッグ中でないときの pointermove は overIndex を変えない（通常のマウス移動を拾わない）", () => {
    const { result } = renderHook(() => useDragReorder(vi.fn()));
    act(() => result.current.dropProps(1).onPointerMove(mkMove()));
    expect(result.current.overIndex).toBeNull();
  });

  it("どの落下先にも重ならず離した（overIndex 無し）ときは onReorder を呼ばない＝クリック相当", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    act(() => result.current.handleProps("s1").onPointerDown(mkDown()));
    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });
    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.draggingId).toBeNull();
  });

  it("主ボタン以外（右クリック等）の pointerdown は無視する", () => {
    const { result } = renderHook(() => useDragReorder(vi.fn()));
    const e = mkDown(2);
    act(() => result.current.handleProps("s1").onPointerDown(e));
    expect(result.current.draggingId).toBeNull();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("pointercancel は中断＝重なり位置があっても onReorder を呼ばず状態だけ戻す", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    act(() => result.current.handleProps("s1").onPointerDown(mkDown()));
    act(() => result.current.dropProps(1).onPointerMove(mkMove()));
    expect(result.current.overIndex).toBe(1); // 重なりはあった
    act(() => {
      window.dispatchEvent(new Event("pointercancel"));
    });
    expect(onReorder).not.toHaveBeenCalled(); // 中断なので並べ替えない
    expect(result.current.draggingId).toBeNull();
    expect(result.current.overIndex).toBeNull();
  });
});
