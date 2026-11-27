// @vitest-environment jsdom
// 元に戻す・やり直す・落ちたときの復旧（MV-0009 ⑨）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const handlers: Record<string, (p: unknown) => void> = {};
const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
let history: { undo: string | null; redo: string | null } = { undo: null, redo: null };
let undoError: string | null = null;
let openFails = 0;

const comp = { id: "cmp_A", name: "本編", width: 640, height: 360, fps: { num: 30, den: 1 }, durationFrames: 300 };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "initial_project") return "C:/v";
    if (cmd === "open_project") {
      if (openFails > 0) {
        openFails -= 1;
        throw "project.json が JSON として壊れています";
      }
      return { dir: "C:/v", name: "見本", mainCompositionId: "cmp_A", compositions: [comp], issues: [] };
    }
    if (cmd === "edit_read")
      return {
        revision: "r1",
        project: {
          name: "見本",
          mainCompositionId: "cmp_A",
          assets: [],
          compositions: [
            {
              ...comp,
              markers: [],
              layers: [
                { id: "A", name: "名前A", type: "solid", enabled: true, locked: false, inFrame: 0, outFrame: 100, startFrame: 0 },
              ],
            },
          ],
        },
      };
    if (cmd === "edit_history") return history;
    if (cmd === "edit_undo" || cmd === "edit_redo") {
      if (undoError) throw undoError;
      return { applied: true };
    }
    if (cmd === "edit_recover") return "r9";
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

const tools = (): HTMLElement => screen.getByLabelText("タイムライン");
const count = (cmd: string): number => calls.filter((c) => c.cmd === cmd).length;

async function mount(): Promise<void> {
  render(<App />);
  await screen.findByTestId("bar-A");
  await act(async () => undefined);
}

describe("元に戻す・やり直す（MV-0009 決定6）", () => {
  beforeEach(() => {
    calls.length = 0;
    history = { undo: null, redo: null };
    undoError = null;
    openFails = 0;
  });
  afterEach(cleanup);

  it("戻せるものが無ければ押せない・あれば何を戻すかを添える", async () => {
    await mount();
    expect((within(tools()).getByRole("button", { name: "元に戻す" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(tools()).getByRole("button", { name: "やり直す" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    history = { undo: "AI：レイヤーを足す", redo: "画面：レイヤーを直す" };
    await mount();
    const u = within(tools()).getByRole("button", { name: "元に戻す" }) as HTMLButtonElement;
    expect(u.disabled).toBe(false);
    expect(u.title).toContain("AI：レイヤーを足す");
    expect(within(tools()).getByRole("button", { name: "やり直す" }).title).toContain("画面：レイヤーを直す");
  });

  it("Ctrl+Z で戻し、Ctrl+Shift+Z と Ctrl+Y でやり直す（そのあと読み直す）", async () => {
    history = { undo: "画面：x", redo: "画面：y" };
    await mount();
    const reads = count("edit_read");
    await act(async () => {
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    });
    expect(calls.filter((c) => c.cmd === "edit_undo").map((c) => c.args)).toEqual([{ dir: "C:/v" }]);
    expect(count("edit_read")).toBe(reads + 1);
    await act(async () => {
      fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    });
    expect(count("edit_redo")).toBe(2);
    await act(async () => {
      fireEvent.click(within(tools()).getByRole("button", { name: "元に戻す" }));
    });
    expect(count("edit_undo")).toBe(2);
  });

  it("断られたら理由を出す", async () => {
    history = { undo: "画面：x", redo: null };
    undoError = "履歴のあとに、別の道で動画が変わっています。上書きしないよう、戻していません。";
    await mount();
    await act(async () => {
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    });
    expect(screen.getByRole("alert").textContent).toContain("上書きしないよう");
  });

  it("文字を打っている欄では Ctrl+Z を奪わない（名前の変更・文）", async () => {
    history = { undo: "画面：x", redo: null };
    await mount();
    fireEvent.doubleClick(screen.getByText("名前A"));
    const input = screen.getByLabelText("レイヤーの名前");
    fireEvent.keyDown(input, { key: "z", ctrlKey: true });
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    fireEvent.keyDown(ta, { key: "z", ctrlKey: true });
    ta.remove();
    expect(count("edit_undo")).toBe(0);
  });
});

describe("落ちたときの復旧（MV-0009 決定5）", () => {
  beforeEach(() => {
    calls.length = 0;
    history = { undo: null, redo: null };
    openFails = 0;
  });
  afterEach(cleanup);

  it("開けなかったら「履歴の最後の状態から開く」を出し、押すまで何も書かない・押すと開き直す", async () => {
    openFails = 1;
    render(<App />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("壊れています");
    expect(count("edit_recover")).toBe(0);
    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "履歴の最後の状態から開く" }));
    });
    expect(calls.filter((c) => c.cmd === "edit_recover").map((c) => c.args)).toEqual([{ dir: "C:/v" }]);
    expect(count("open_project")).toBe(2);
    await screen.findByTestId("bar-A");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
