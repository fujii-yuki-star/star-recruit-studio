// @vitest-environment jsdom
// 親子付けとヌル（MV-0010 ①）＝親の列・ヌルを足す・親のある子をプレビューで掴む。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const handlers: Record<string, (p: unknown) => void> = {};
const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
let applyWarnings: string[] = [];

const comp = { id: "cmp_A", name: "本編", width: 640, height: 360, fps: { num: 30, den: 1 }, durationFrames: 300 };
const tf = { anchor: { value: [0, 0] }, position: { value: [100, 50] }, scale: { value: [1, 1] }, rotation: { value: 0 }, opacity: { value: 1 } };
const layer = (id: string, type: string, parentId: string | null = null): unknown => ({
  id,
  name: `名前${id}`,
  type,
  enabled: true,
  locked: false,
  inFrame: 0,
  outFrame: 100,
  startFrame: 0,
  parentId,
  transform: tf,
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "initial_project") return "C:/v";
    if (cmd === "open_project")
      return { dir: "C:/v", name: "見本", mainCompositionId: "cmp_A", compositions: [comp], issues: [] };
    if (cmd === "edit_read")
      return {
        revision: "r1",
        project: {
          name: "見本",
          mainCompositionId: "cmp_A",
          assets: [],
          compositions: [
            { ...comp, markers: [], layers: [layer("CHILD", "solid", "NULL"), layer("NULL", "null"), layer("OTHER", "solid")] },
          ],
        },
      };
    if (cmd === "edit_apply") return { applied: true, revision: "r2", reapplied: false, created: [], warnings: applyWarnings };
    if (cmd === "edit_eval") return { "/transform/position": [100, 50] };
    if (cmd === "edit_history") return { undo: null, redo: null };
    if (cmd === "preview_bounds")
      return {
        frame: 0,
        scale: 1,
        layers: [
          // 子は 2 倍の親の下＝親の向きと大きさ [2,0,0,2]
          { layerId: "CHILD", corners: [[0, 0], [40, 0], [40, 40], [0, 40]], parentLinear: [2, 0, 0, 2] },
          { layerId: "NULL", corners: [[0, 0], [200, 0], [200, 200], [0, 200]], parentLinear: [1, 0, 0, 1] },
        ],
      };
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
  await screen.findByTestId("bar-CHILD");
  await waitFor(() => expect(calls.some((c) => c.cmd === "preview_bounds")).toBe(true));
  await act(async () => undefined);
}

describe("親子付けとヌル（MV-0010 ①）", () => {
  beforeEach(() => {
    calls.length = 0;
    applyWarnings = [];
  });
  afterEach(cleanup);

  it("親の列は今の親を見せ、自分と子孫を選ばせない・付け替えは今の時刻で見た目を保つ取引", async () => {
    await mount();
    act(() => handlers["preview-status"]({ compositionId: "cmp_A", frame: 7, playing: false, fps: 0, dropped: 0 }));
    const childSel = screen.getByRole("combobox", { name: "名前CHILDの親" }) as HTMLSelectElement;
    expect(childSel.value).toBe("NULL");
    // ヌルの親には、自分（NULL）と子（CHILD）を出さない
    const nullSel = screen.getByRole("combobox", { name: "名前NULLの親" });
    expect(within(nullSel).getAllByRole("option").map((o) => o.textContent)).toEqual(["親なし", "名前OTHER"]);
    await act(async () => {
      fireEvent.change(childSel, { target: { value: "OTHER" } });
    });
    await act(async () => {
      fireEvent.change(childSel, { target: { value: "" } });
    });
    expect(applied()).toEqual([
      [{ op: "setParent", layerId: "CHILD", parentId: "OTHER", frame: 7 }],
      [{ op: "setParent", layerId: "CHILD", parentId: null, frame: 7 }],
    ]);
  });

  it("見た目を保てなかったときは知らせる（黙って別の見た目にしない）", async () => {
    await mount();
    applyWarnings = ["「名前CHILD」の位置・大きさ・回転のどれかがキーフレームか式なので、見た目を保たずに親を付け替えました。"];
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "名前CHILDの親" }), { target: { value: "OTHER" } });
    });
    expect(screen.getByRole("status").textContent).toContain("見た目を保たずに");
  });

  it("「ヌルを足す」でいちばん手前にヌルを足す", async () => {
    await mount();
    await act(async () => {
      fireEvent.click(within(screen.getByLabelText("タイムライン")).getByRole("button", { name: "ヌルを足す" }));
    });
    expect(applied()).toEqual([
      [{ op: "addLayer", compositionId: "cmp_A", index: 0, layer: { name: "ヌル", type: "null" } }],
    ]);
  });

  it("親のある子をプレビューで掴むと、位置の差は親の大きさの逆（2 倍の親なら半分）", async () => {
    await mount();
    const ov = screen.getByTestId("preview-overlay");
    fireEvent.pointerDown(ov, { button: 0, clientX: 20, clientY: 20 });
    await act(async () => undefined);
    fireEvent.pointerMove(ov, { clientX: 30, clientY: 24 });
    await act(async () => {
      fireEvent.pointerUp(ov, { clientX: 30, clientY: 24 });
    });
    expect(applied()).toEqual([
      [{ op: "updateLayer", layerId: "CHILD", patch: { transform: { position: { value: [105, 52] } } } }],
    ]);
  });
});
