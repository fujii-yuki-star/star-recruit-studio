// @vitest-environment jsdom
// このパソコンの中で作っている間、書いている場面の数を見せる（ADR-0052 決定6・#1293）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { writingSceneMessage } from "../uiLabels";

const bus = vi.hoisted(() => ({ handler: null as null | ((e: { scenes: number }) => void), offCalls: 0, videoKind: "recruit" }));
vi.mock("../../infrastructure/aiClient", () => ({
  onAiBusyWait: () => Promise.resolve(() => {}),
  onLocalAiProgress: (h: (e: { scenes: number }) => void) => {
    bus.handler = h;
    return Promise.resolve(() => { bus.offCalls += 1; bus.handler = null; });
  },
}));
vi.mock("../store/projectStore", () => ({
  useProjectStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ status: "generating", meta: { videoKind: bus.videoKind }, aiError: null, generate: () => Promise.resolve(), cancelGeneration: () => {}, fail: () => {}, reset: () => {}, startManualEdit: () => {} }),
}));

import { GeneratingScreen } from "./GeneratingScreen";

beforeEach(() => { bus.handler = null; bus.offCalls = 0; bus.videoKind = "recruit"; });

describe("書いている場面の数を見せる", () => {
  it("書き始める前は、準備している文のまま", async () => {
    render(<GeneratingScreen onNavigate={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/準備しています/)).toBeTruthy();
  });

  // 一般（発表）の動画に「会社情報」と出さない（UI/UX 監査 2026-10-02）。
  it("準備の文は動画の種類で言い分ける（採用＝会社情報／一般＝伝えたい内容）", async () => {
    const { unmount } = render(<GeneratingScreen onNavigate={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/^会社情報と素材をもとに/)).toBeTruthy();
    unmount();
    bus.videoKind = "general";
    render(<GeneratingScreen onNavigate={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/^伝えたい内容と素材をもとに/)).toBeTruthy();
    expect(screen.queryByText(/会社情報/)).toBeNull();
  });

  it("知らせが来たら、何場面目を書いているかを出し、増えたら更新する", async () => {
    render(<GeneratingScreen onNavigate={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { bus.handler!({ scenes: 1 }); });
    expect(screen.getByText(writingSceneMessage(1))).toBeTruthy();
    await act(async () => { bus.handler!({ scenes: 3 }); });
    expect(screen.getByText(writingSceneMessage(3))).toBeTruthy();
    expect(writingSceneMessage(3)).toBe("3 場面目を書いています。このままお待ちください。");
  });

  it("画面を離れたら知らせを外す（消えた画面へ書き込まない）", async () => {
    const { unmount } = render(<GeneratingScreen onNavigate={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    unmount();
    expect(bus.offCalls).toBe(1);
  });
});
