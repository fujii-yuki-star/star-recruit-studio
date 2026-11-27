// @vitest-environment jsdom
// 速度・タイムリマップ（MV-0012 ③）＝項目の欄の「速度」と「タイムリマップ」・Ctrl+Alt+T。
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

function click(id: string, mods: { ctrlKey?: boolean } = {}): void {
  fireEvent.pointerDown(screen.getByTestId(`bar-${id}`), { button: 0, clientX: 50, ...mods });
  fireEvent.pointerUp(screen.getByTestId("timeline"), { clientX: 50 });
}

describe("速度・タイムリマップ（MV-0012 ③）", () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(cleanup);

  it("単色には「時間」の段が出ない", async () => {
    await mount();
    click("A");
    expect(screen.queryByTestId("prop-speed")).toBeNull();
  });

  it("映像は速度 100%・数を入れると setSpeed", async () => {
    await mount();
    click("V");
    const field = screen.getByRole("spinbutton", { name: "速度" });
    expect(field.getAttribute("aria-valuenow")).toBe("100");
    expect((screen.getByRole("checkbox", { name: "タイムリマップ" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.pointerDown(field, { button: 0, clientX: 10 });
    fireEvent.pointerUp(field, { clientX: 10 });
    const input = screen.getByRole("textbox", { name: "速度" });
    fireEvent.change(input, { target: { value: "50" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(applied()).toEqual([[{ op: "setSpeed", layerId: "V", percent: 50 }]]);
  });

  it("入れ子の逆再生は −200%・細かいリマップは数でなく「タイムリマップ」", async () => {
    await mount();
    click("P");
    expect(screen.getByRole("spinbutton", { name: "速度" }).getAttribute("aria-valuenow")).toBe("-200");
    expect((screen.getByRole("checkbox", { name: "タイムリマップ" }) as HTMLInputElement).checked).toBe(true);
    click("R");
    expect(screen.queryByRole("spinbutton", { name: "速度" })).toBeNull();
    expect(screen.getByTestId("prop-speed").textContent).toContain("タイムリマップ");
  });

  it("タイムリマップの入り切り＝欄と Ctrl+Alt+T（錠・単色は除く）", async () => {
    await mount();
    click("V");
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "タイムリマップ" }));
    });
    expect(applied()).toEqual([[{ op: "enableTimeRemap", layerId: "V", enabled: true }]]);
    calls.length = 0;
    click("A", { ctrlKey: true });
    click("P", { ctrlKey: true });
    click("LV", { ctrlKey: true });
    await act(async () => {
      fireEvent.keyDown(window, { key: "t", ctrlKey: true, altKey: true });
    });
    expect(applied()).toEqual([
      [
        { op: "enableTimeRemap", layerId: "V", enabled: true },
        { op: "enableTimeRemap", layerId: "P", enabled: false },
      ],
    ]);
  });
});
