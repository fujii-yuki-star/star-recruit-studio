// @vitest-environment jsdom
// 入れ子（MV-0011 ②）＝プリコンポーズ（Ctrl+Shift+C・帯のボタン）と、入れ子の帯をダブルクリックで中を開く。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

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
              layers: [layer("A"), layer("L", { locked: true }), layer("P", { type: "precomp", compositionId: "cmp_IN" }), layer("B")],
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

describe("入れ子（MV-0011 ②）", () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(cleanup);

  it("Ctrl+Shift+C で選んだものをプリコンポーズ（並びの順・錠は移さない）", async () => {
    await mount();
    click("B");
    click("A", { ctrlKey: true });
    click("L", { ctrlKey: true });
    await act(async () => {
      fireEvent.keyDown(window, { key: "C", ctrlKey: true, shiftKey: true });
    });
    expect(applied()).toEqual([[{ op: "precompose", layerIds: ["A", "B"], name: "入れ子" }]]);
  });

  it("帯の「プリコンポーズ」は、選んでいなければ押せない", async () => {
    await mount();
    const btn = within(screen.getByLabelText("タイムライン")).getByRole("button", { name: "プリコンポーズ" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    click("A");
    expect(btn.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(applied()).toEqual([[{ op: "precompose", layerIds: ["A"], name: "入れ子" }]]);
  });

  it("入れ子の帯をダブルクリックすると、その中を開く（ほかの帯では開かない）", async () => {
    await mount();
    fireEvent.doubleClick(screen.getByTestId("bar-A"));
    expect(calls.filter((c) => c.cmd === "preview_set_composition")).toEqual([]);
    fireEvent.doubleClick(screen.getByTestId("bar-P"));
    expect(calls.filter((c) => c.cmd === "preview_set_composition").map((c) => c.args)).toEqual([{ id: "cmp_IN" }]);
    expect((screen.getByRole("combobox", { name: /コンポジション/ }) as HTMLSelectElement).value).toBe("cmp_IN");
    await screen.findByTestId("bar-IN1");
  });
});
