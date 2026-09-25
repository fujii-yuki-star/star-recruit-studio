// @vitest-environment jsdom
// 混み合っているあいだ、画面が黙らないこと（#1244・利用者の指摘 2026-09-25）。
//
// ⚠️ **裏で最長 30 秒ほど待つ**ようになったので、何も言わないと**固まったように見える**。
// 以前は待ち直さずにその場で落ちていたので、この状態そのものが存在しなかった。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const bus = vi.hoisted(() => ({ handler: null as null | ((e: { attempt: number; total: number; wait_ms: number }) => void), offCalls: 0 }));
vi.mock("../../infrastructure/aiClient", () => ({
  onAiBusyWait: (h: (e: { attempt: number; total: number; wait_ms: number }) => void) => {
    bus.handler = h;
    return Promise.resolve(() => { bus.offCalls += 1; bus.handler = null; });
  },
}));
vi.mock("../store/projectStore", () => ({
  useProjectStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ status: "generating", aiError: null, generate: () => Promise.resolve(), cancelGeneration: () => {}, fail: () => {}, reset: () => {}, startManualEdit: () => {} }),
}));

import { GeneratingScreen } from "./GeneratingScreen";

beforeEach(() => { bus.handler = null; bus.offCalls = 0; });

describe("動画案を作っている間の知らせ", () => {
  it("ふだんは、待たせている理由をわざわざ言わない", async () => {
    render(<GeneratingScreen onNavigate={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText(/混み合っている/)).toBeNull();
  });

  it("混み合って待ち直しているときは、そう言う（黙って止まらない）", async () => {
    render(<GeneratingScreen onNavigate={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(bus.handler, "知らせを受け取る用意ができていない").not.toBeNull();
    await act(async () => { bus.handler!({ attempt: 1, total: 3, wait_ms: 3000 }); });
    expect(screen.getByText(/混み合っている/)).toBeTruthy();
  });

  // ⚠️ **回数は出さない**＝「2回目」と言われても利用者にできることは無い（不安になるだけ）。
  it("何回目かは画面に出さない", async () => {
    render(<GeneratingScreen onNavigate={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { bus.handler!({ attempt: 2, total: 3, wait_ms: 10000 }); });
    expect(screen.queryByText(/2回目|2 回目/)).toBeNull();
  });

  it("画面を離れたら知らせの受け取りをやめる（消えた画面へ書き込まない）", async () => {
    const { unmount } = render(<GeneratingScreen onNavigate={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(bus.offCalls).toBe(1);
  });
});
