// @vitest-environment jsdom
// モーションブラー（MV-0013 ④）＝行の「M」とコンポジションのスイッチ。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const handlers: Record<string, (p: unknown) => void> = {};
const calls: { cmd: string; args?: Record<string, unknown> }[] = [];

const main = { id: "cmp_A", name: "本編", width: 640, height: 360, fps: { num: 30, den: 1 }, durationFrames: 300 };
const inner = { id: "cmp_IN", name: "中身", width: 320, height: 180, fps: { num: 24, den: 1 }, durationFrames: 48 };
const layer = (id: string, extra: Record<string, unknown> = {}): unknown => ({
  id,
  name: `名前${id}`,
  type: "solid",
  enabled: true,
  locked: false,
  inFrame: 0,
  outFrame: 100,
  startFrame: 0,
  ...extra,
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "initial_project") return "C:/v";
    if (cmd === "open_project")
      return { dir: "C:/v", name: "見本", mainCompositionId: "cmp_A", compositions: [main, inner], issues: [] };
    if (cmd === "edit_read")
      return {
        revision: "r1",
        project: {
          name: "見本",
          mainCompositionId: "cmp_A",
          assets: [],
          compositions: [
            {
              ...main,
              markers: [],
              layers: [
                layer("A"),
                layer("V", { type: "video" }),
                layer("R", {
                  type: "audio",
                  timeRemap: {
                    keyframes: [
                      { frame: 0, value: 0, interpolation: "linear" },
                      { frame: 10, value: 1, interpolation: "linear" },
                      { frame: 20, value: 1, interpolation: "linear" },
                    ],
                  },
                }),
                layer("P", {
                  type: "precomp",
                  compositionId: "cmp_IN",
                  timeRemap: {
                    keyframes: [
                      { frame: 0, value: 2, interpolation: "linear" },
                      { frame: 30, value: 0, interpolation: "linear" },
                    ],
                  },
                }),
                layer("LV", { type: "video", locked: true }),
              ],
            },
            { ...inner, markers: [], layers: [layer("IN1")] },
          ],
        },
      };
    if (cmd === "edit_apply") return { applied: true, revision: "r2", reapplied: false, created: [] };
    if (cmd === "edit_history") return { undo: null, redo: null };
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, f: (e: { payload: unknown }) => void) => {
    handlers[name] = (p) => f({ payload: p });
    return () => undefined;
  }),
}));

const { App } = await import("./App");
const applied = (): unknown[] => calls.filter((c) => c.cmd === "edit_apply").map((c) => c.args?.ops);

async function mount(): Promise<void> {
  render(<App />);
  await screen.findByTestId("bar-A");
  await act(async () => undefined);
}

describe("モーションブラーのスイッチ（MV-0013 ④）", () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(cleanup);

  it("行の M でレイヤーのスイッチ・上のボタンでコンポジションのスイッチ（今の状態を押されて見せる）", async () => {
    await mount();
    const row = screen.getByTestId("row-V");
    const m = row.querySelector('button[aria-label="モーションブラー"]') as HTMLButtonElement;
    expect(m.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      fireEvent.click(m);
    });
    const comp = screen.getByRole("button", { name: "コンポジションのモーションブラー", pressed: false });
    await act(async () => {
      fireEvent.click(comp);
    });
    expect(applied()).toEqual([
      [{ op: "updateLayer", layerId: "V", patch: { motionBlur: true } }],
      [{ op: "updateComposition", compositionId: "cmp_A", patch: { motionBlur: { enabled: true } } }],
    ]);
  });
});
