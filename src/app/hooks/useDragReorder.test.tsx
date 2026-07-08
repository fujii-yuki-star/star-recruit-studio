// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { DragEvent } from "react";
import { useDragReorder } from "./useDragReorder";

// 最小の DragEvent モック（preventDefault と dataTransfer だけ使う）。
const mkEvent = () =>
  ({
    preventDefault: vi.fn(),
    dataTransfer: { effectAllowed: "", dropEffect: "", setData: vi.fn() },
  }) as unknown as DragEvent;

describe("useDragReorder（DnD 並び替え・#398）", () => {
  it("onDragStart で draggingId を持ち、onDrop で onReorder(fromId, index) を呼んで解除する", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    act(() => result.current.handleProps("scene_001").onDragStart(mkEvent()));
    expect(result.current.draggingId).toBe("scene_001");
    act(() => result.current.dropProps(2).onDrop(mkEvent()));
    expect(onReorder).toHaveBeenCalledWith("scene_001", 2);
    expect(result.current.draggingId).toBeNull();
    expect(result.current.overIndex).toBeNull();
  });

  it("onDragOver は draggingId があるとき overIndex を更新し preventDefault する（drop を許可）", () => {
    const { result } = renderHook(() => useDragReorder(vi.fn()));
    act(() => result.current.handleProps("s1").onDragStart(mkEvent()));
    const e = mkEvent();
    act(() => result.current.dropProps(1).onDragOver(e));
    expect(result.current.overIndex).toBe(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("draggingId が無い（外部ドラッグ＝ファイル等）ときは onDragOver/onDrop を無視する", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    const over = mkEvent();
    act(() => result.current.dropProps(0).onDragOver(over));
    expect(over.preventDefault).not.toHaveBeenCalled();
    expect(result.current.overIndex).toBeNull();
    act(() => result.current.dropProps(0).onDrop(mkEvent()));
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("onDragEnd で解除する（ドロップせず離した場合）", () => {
    const { result } = renderHook(() => useDragReorder(vi.fn()));
    act(() => result.current.handleProps("s1").onDragStart(mkEvent()));
    act(() => result.current.handleProps("s1").onDragEnd());
    expect(result.current.draggingId).toBeNull();
    expect(result.current.overIndex).toBeNull();
  });
});
