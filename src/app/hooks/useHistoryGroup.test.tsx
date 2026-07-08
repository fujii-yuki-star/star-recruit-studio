// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHistoryGroup } from "./useHistoryGroup";
import { useProjectStore } from "../store/projectStore";

describe("useHistoryGroup（連続編集を1履歴に・#389）", () => {
  const realBegin = useProjectStore.getState().beginHistoryGroup;
  const realEnd = useProjectStore.getState().endHistoryGroup;
  afterEach(() => useProjectStore.setState({ beginHistoryGroup: realBegin, endHistoryGroup: realEnd }));

  it("dragGroup: pointerdown で begin、window の pointerup で end（要素外で離しても閉じる・one-shot）", () => {
    const begin = vi.fn();
    const end = vi.fn();
    useProjectStore.setState({ beginHistoryGroup: begin, endHistoryGroup: end });
    const { result } = renderHook(() => useHistoryGroup());
    result.current.dragGroup.onPointerDown();
    expect(begin).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
    // 要素外で指を離しても window で拾って閉じる（取りこぼしで開きっぱなしにならない）。
    window.dispatchEvent(new Event("pointerup"));
    expect(end).toHaveBeenCalledTimes(1);
    // 自己解除＝もう一度 pointerup が来ても end は増えない。
    window.dispatchEvent(new Event("pointerup"));
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("textGroup: focus で begin・blur で end", () => {
    const begin = vi.fn();
    const end = vi.fn();
    useProjectStore.setState({ beginHistoryGroup: begin, endHistoryGroup: end });
    const { result } = renderHook(() => useHistoryGroup());
    result.current.textGroup.onFocus();
    result.current.textGroup.onBlur();
    expect(begin).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });
});
