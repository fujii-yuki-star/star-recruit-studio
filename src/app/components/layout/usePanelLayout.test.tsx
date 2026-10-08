// @vitest-environment jsdom
// 欄の配置の出し入れ（ADR-0033）＝覚えない指定（ADR-0050 決定10＝仕上がり確認の別窓が本体の配置を上書きしない）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePanelLayout } from "./usePanelLayout";
import { PANEL_ID, PANEL_IDS, timelineDefaultLayout, timelineLayoutPresets } from "../../timelinePanels";
import { PANEL_SCREEN } from "../../../domain/layout/panelLayout";
import { getPanelLayout, setPanelLayout } from "../../../infrastructure/appSettings";

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

beforeEach(() => localStorage.clear());

describe("usePanelLayout の覚えない指定（ADR-0050 決定10）", () => {
  it("覚える（既定）＝変えたら書き、次は覚えた配置から始める", async () => {
    const other = timelineLayoutPresets()[0].layout;
    const { result, unmount } = renderHook(() => usePanelLayout(PANEL_SCREEN.timeline, timelineDefaultLayout(), PANEL_IDS));
    act(() => result.current.change(other));
    await wait(400);
    unmount();
    expect(getPanelLayout(PANEL_SCREEN.timeline)).not.toBeNull();
  });

  it("覚えない＝覚えた配置を読まず、変えても・閉じても・既定へ戻しても書かない（消しもしない）", async () => {
    const saved = timelineLayoutPresets()[1].layout;
    setPanelLayout(PANEL_SCREEN.timeline, saved);
    const before = localStorage.getItem([...Object.keys(localStorage)][0]);
    const { result, unmount } = renderHook(() =>
      usePanelLayout(PANEL_SCREEN.timeline, timelineDefaultLayout(), PANEL_IDS, { persist: false }),
    );
    // 読まない＝既定から始まる（本体が閉じた欄があっても、別窓の仕上がり確認は居る）。
    expect(result.current.closed).not.toContain(PANEL_ID.preview);
    expect(result.current.layout).toEqual(timelineDefaultLayout());
    act(() => result.current.change(timelineLayoutPresets()[0].layout));
    await wait(400);
    act(() => result.current.reset());
    unmount();
    expect(Object.keys(localStorage)).toHaveLength(1);
    expect(localStorage.getItem([...Object.keys(localStorage)][0])).toBe(before);
  });

  it("覚えない＝変えた直後に離れても書かない", () => {
    const { result, unmount } = renderHook(() =>
      usePanelLayout(PANEL_SCREEN.timeline, timelineDefaultLayout(), PANEL_IDS, { persist: false }),
    );
    act(() => result.current.change(timelineLayoutPresets()[0].layout));
    unmount();
    expect(Object.keys(localStorage)).toEqual([]);
  });
});

// 配置を覚えられないとき（ADR-0033 未解決6 の決着・#1396）＝**黙って諦めない**。ただし境界のドラッグごとに出し直さない。
describe("usePanelLayout の覚えられなかった知らせ（#1396）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("書けなかったら知らせを立て、閉じたらこの画面ではもう立てない", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    const presets = timelineLayoutPresets();
    const { result } = renderHook(() => usePanelLayout(PANEL_SCREEN.timeline, timelineDefaultLayout(), PANEL_IDS));
    expect(result.current.saveFailed).toBe(false);
    act(() => result.current.change(presets[0].layout));
    await wait(400);
    expect(result.current.saveFailed).toBe(true);
    act(() => result.current.dismissSaveFailed());
    expect(result.current.saveFailed).toBe(false);
    act(() => result.current.change(presets[1].layout));
    await wait(400);
    expect(result.current.saveFailed).toBe(false);
  });

  it("書けたら立てない", async () => {
    const { result } = renderHook(() => usePanelLayout(PANEL_SCREEN.timeline, timelineDefaultLayout(), PANEL_IDS));
    act(() => result.current.change(timelineLayoutPresets()[0].layout));
    await wait(400);
    expect(result.current.saveFailed).toBe(false);
  });

  it("setPanelLayout は保存できたかを返す", () => {
    expect(setPanelLayout(PANEL_SCREEN.timeline, timelineDefaultLayout())).toBe(true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    expect(setPanelLayout(PANEL_SCREEN.timeline, timelineDefaultLayout())).toBe(false);
  });
});
