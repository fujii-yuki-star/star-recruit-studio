// @vitest-environment jsdom
// イージングのグラフ（MV-0015 ⑥）＝Shift+F3・値の行を押して出す・値と速さ・取っ手とキーを掴む。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const handlers: Record<string, (p: unknown) => void> = {};
const calls: { cmd: string; args?: Record<string, unknown> }[] = [];

const main = { id: "cmp_A", name: "本編", width: 640, height: 360, fps: { num: 30, den: 1 }, durationFrames: 300 };
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
      return { dir: "C:/v", name: "見本", mainCompositionId: "cmp_A", compositions: [main], issues: [] };
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
                layer("G", {
                  transform: {
                    rotation: {
                      keyframes: [
                        { frame: 0, value: 0, interpolation: "bezier", easeOut: [1 / 3, 0] },
                        { frame: 30, value: 90, interpolation: "linear", easeIn: [2 / 3, 1] },
                      ],
                    },
                    opacity: { value: 1 },
                  },
                }),
                layer("L", {
                  locked: true,
                  transform: {
                    rotation: {
                      keyframes: [
                        { frame: 0, value: 0, interpolation: "bezier" },
                        { frame: 30, value: 90, interpolation: "linear" },
                      ],
                    },
                  },
                }),
              ],
            },
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
  await screen.findByTestId("bar-G");
  await act(async () => undefined);
}

const ROT = "/transform/rotation";

async function openGraphOn(id: string): Promise<void> {
  await mount();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: `名前${id}の値を開く` }));
  });
  await act(async () => {
    fireEvent.keyDown(window, { key: "F3", shiftKey: true });
  });
  fireEvent.pointerDown(screen.getByTestId(`prop-row-${id}-${ROT}`).querySelector(".tl-name") as HTMLElement, {
    button: 0,
  });
  await act(async () => undefined);
}

/** グラフの中の点を、掴んで (x, y) へ動かして離す（jsdom の枠は 0＝画面の位置がそのままグラフの画素）。 */
async function dragTo(el: Element, x: number, y: number): Promise<void> {
  fireEvent.pointerDown(el, { button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(screen.getByTestId("graph-svg"), { clientX: x, clientY: y });
  await act(async () => {
    fireEvent.pointerUp(screen.getByTestId("graph-svg"), { clientX: x, clientY: y });
  });
}

const rotKeys = (ops: unknown): { easeOut?: number[]; easeIn?: number[]; value: number }[] =>
  (ops as { patch: { transform: { rotation: { keyframes: { easeOut?: number[]; easeIn?: number[]; value: number }[] } } } }[])[0]
    .patch.transform.rotation.keyframes;

describe("イージングのグラフ（MV-0015 ⑥）", () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(cleanup);

  it("上の「グラフ」と Shift+F3 で出し入れ・値の行を押すまでは案内", async () => {
    await mount();
    const btn = screen.getByRole("button", { name: /グラフ/ });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/値の行（名前か◆）を押すと/)).toBeTruthy();
    expect(screen.queryByTestId("graph")).toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: "F3", shiftKey: true });
    });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText(/値の行（名前か◆）を押すと/)).toBeNull();
  });

  it("値の行の名前を押すとその値のグラフ（値＝線・取っ手・キー／速さに切り替え）", async () => {
    await openGraphOn("G");
    expect(screen.getByTestId("graph").textContent).toContain("回転（名前G）");
    expect(screen.getByTestId("graph-line-0")).toBeTruthy();
    expect(screen.getByTestId("graph-handle-out-0-0")).toBeTruthy();
    expect(screen.getByTestId("graph-handle-in-0-0")).toBeTruthy();
    expect(screen.getByTestId("graph-key-1-0")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "速さ" }));
    });
    expect(screen.getByRole("button", { name: "速さ" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("graph-handle-out-0--1")).toBeTruthy();
    expect(screen.queryByTestId("graph-key-1-0")).toBeNull();
  });

  it("値のグラフで出の取っ手を掴む＝試し・離すと easeOut を書く1つの取引", async () => {
    await openGraphOn("G");
    // 縦の範囲＝-9〜99（線 0〜90・取っ手 0 と 90 に 10% の余白）・高さ 348（余白 16）＝値 45 は y=174
    await dragTo(screen.getByTestId("graph-handle-out-0-0"), 15, 174);
    const ops = applied();
    expect(ops).toHaveLength(1);
    const k = rotKeys(ops[0]);
    expect(k[0].easeOut?.[0]).toBeCloseTo(0.5, 9);
    expect(k[0].easeOut?.[1]).toBeCloseTo(0.5, 9);
    expect(k[1].easeIn).toEqual([2 / 3, 1]);
  });

  it("速さのグラフで入りの取っ手を掴む＝影響と速さから easeIn を書く", async () => {
    await openGraphOn("G");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "速さ" }));
    });
    // 入りの取っ手を横 15（影響 50%）・速さ 0（いちばん下＝範囲の下限より下でも 0 に収める）へ
    await dragTo(screen.getByTestId("graph-handle-in-0--1"), 15, 10000);
    const k = rotKeys(applied()[0]);
    expect(k[1].easeIn?.[0]).toBeCloseTo(0.5, 9);
    expect(k[1].easeIn?.[1]).toBeCloseTo(1, 9);
    expect(k[0].easeOut).toEqual([1 / 3, 0]);
  });

  it("値のグラフでキーを上下＝そのキーの値", async () => {
    await openGraphOn("G");
    await dragTo(screen.getByTestId("graph-key-1-0"), 30, 174);
    expect(rotKeys(applied()[0])[1].value).toBeCloseTo(45, 9);
  });

  it("掴んでいる間も新しい線で描き、縦の範囲は掴んだときのまま（取っ手が上へはみ出す）", async () => {
    await openGraphOn("G");
    const h = screen.getByTestId("graph-handle-out-0-0");
    const line0 = screen.getByTestId("graph-line-0").getAttribute("points");
    fireEvent.pointerDown(h, { button: 0, clientX: 0, clientY: 0 });
    // 値 300（範囲 -9〜99 の上）へ
    fireEvent.pointerMove(screen.getByTestId("graph-svg"), { clientX: 10, clientY: 16 - ((300 - 99) / 108) * 316 });
    expect(screen.getByTestId("graph-line-0").getAttribute("points")).not.toBe(line0);
    expect(Number(screen.getByTestId("graph-handle-out-0-0").getAttribute("cy"))).toBeLessThan(0);
    await act(async () => {
      fireEvent.pointerUp(screen.getByTestId("graph-svg"), { clientX: 10, clientY: 0 });
    });
  });

  it("キーの無い値の行を押すと案内（グラフは出さない）", async () => {
    await openGraphOn("G");
    fireEvent.pointerDown(screen.getByTestId("prop-row-G-/transform/opacity").querySelector(".tl-name") as HTMLElement, {
      button: 0,
    });
    await act(async () => undefined);
    expect(screen.queryByTestId("graph")).toBeNull();
    expect(screen.getByText(/値の行（名前か◆）を押すと/)).toBeTruthy();
  });

  it("錠のかかったレイヤーの取っ手とキーは動かない", async () => {
    await openGraphOn("L");
    await dragTo(screen.getByTestId("graph-handle-out-0-0"), 15, 174);
    expect(calls.filter((c) => c.cmd === "edit_trial")).toEqual([]);
    expect(applied()).toEqual([]);
  });
});
