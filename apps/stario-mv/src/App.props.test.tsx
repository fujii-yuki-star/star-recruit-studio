// @vitest-environment jsdom
// 値の欄とキーフレームを打つ（MV-0008 ⑧-2）＝値は Rust に求めてもらい、書くのは取引（掴んでいる途中は試し）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const handlers: Record<string, (p: unknown) => void> = {};
const calls: { cmd: string; args?: Record<string, unknown> }[] = [];

const comp = { id: "cmp_A", name: "本編", width: 640, height: 360, fps: { num: 30, den: 1 }, durationFrames: 300 };
const transform = (extra: Record<string, unknown> = {}): unknown => ({
  anchor: { value: [10, 10] },
  position: { value: [100, 50] },
  scale: { value: [1, 1] },
  rotation: { value: 0 },
  opacity: { value: 1 },
  ...extra,
});
const layers = (): unknown[] => [
  {
    id: "A",
    name: "動く",
    type: "solid",
    enabled: true,
    locked: false,
    inFrame: 0,
    outFrame: 100,
    startFrame: 0,
    blendMode: "normal",
    solid: { color: [1, 0, 0, 1], width: 200, height: 100 },
    transform: transform({
      position: {
        keyframes: [
          { frame: 10, value: [0, 0], interpolation: "linear" },
          { frame: 30, value: [100, 0], interpolation: "linear" },
        ],
      },
    }),
  },
  {
    id: "T",
    name: "見出し",
    type: "text",
    enabled: true,
    locked: false,
    inFrame: 0,
    outFrame: 100,
    startFrame: 0,
    text: { text: "こんにちは", fontFamily: "Gen", fontSize: 40, fill: [1, 1, 1, 1] },
    transform: transform(),
  },
  {
    id: "L",
    name: "錠",
    type: "solid",
    enabled: true,
    locked: true,
    inFrame: 0,
    outFrame: 100,
    startFrame: 0,
    solid: { color: [0, 0, 1, 1], width: 10, height: 10 },
    transform: transform(),
  },
];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "initial_project") return "C:/v";
    if (cmd === "open_project")
      return { dir: "C:/v", name: "見本", mainCompositionId: "cmp_A", compositions: [comp], issues: [] };
    if (cmd === "edit_read")
      return {
        revision: "r1",
        project: { name: "見本", mainCompositionId: "cmp_A", assets: [], compositions: [{ ...comp, markers: [], layers: layers() }] },
      };
    if (cmd === "edit_apply") return { applied: true, revision: "r2", reapplied: false, created: [] };
    if (cmd === "edit_eval") {
      // Rust が求めた値の代わり（キーの間は 20 フレームで [50, 0]）
      const id = (args?.layer as { id: string }).id;
      return {
        "/transform/anchor": [10, 10],
        "/transform/position": id === "A" ? [50, 0] : [100, 50],
        "/transform/scale": [1, 1],
        "/transform/rotation": 0,
        "/transform/opacity": 1,
      };
    }
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

async function selectLayer(id: string, frame = 20): Promise<HTMLElement> {
  render(<App />);
  await screen.findByTestId(`bar-${id}`);
  act(() => handlers["preview-status"]({ compositionId: "cmp_A", frame, playing: false, fps: 0, dropped: 0 }));
  fireEvent.pointerDown(screen.getByTestId(`bar-${id}`), { button: 0, clientX: 50 });
  fireEvent.pointerUp(screen.getByTestId("timeline"), { clientX: 50 });
  const panel = await screen.findByTestId("props-panel");
  // 値は Rust に求めてもらってから出る
  await screen.findAllByRole("spinbutton", { name: /位置/ });
  return panel;
}

describe("値の欄（MV-0008 ⑧-2）", () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(cleanup);

  it("今の時刻の値を Rust に求めてもらって出す（大きさ・不透明度は %）", async () => {
    const p = await selectLayer("T");
    expect(calls.find((c) => c.cmd === "edit_eval")?.args).toMatchObject({ frame: 20, layer: { id: "T" } });
    expect(within(p).getByRole("spinbutton", { name: "位置 x" }).textContent).toBe("100.0");
    expect(within(p).getByRole("spinbutton", { name: "位置 y" }).textContent).toBe("50.0");
    expect(within(p).getByRole("spinbutton", { name: "大きさ x" }).textContent).toBe("100.0%");
    expect(within(p).getByRole("spinbutton", { name: "不透明度" }).textContent).toBe("100.0%");
    expect(within(p).getByRole("spinbutton", { name: "文字の大きさ" }).textContent).toBe("40.0");
  });

  it("数を左右に掴むと試しを送り、離すと1つの取引（固定値を変える）", async () => {
    const p = await selectLayer("T");
    const x = within(p).getByRole("spinbutton", { name: "位置 x" });
    fireEvent.pointerDown(x, { button: 0, clientX: 100 });
    fireEvent.pointerMove(x, { clientX: 112 });
    const trial = calls.filter((c) => c.cmd === "edit_trial").at(-1)?.args?.ops;
    expect(trial).toEqual([{ op: "updateLayer", layerId: "T", patch: { transform: { position: { value: [112, 50] } } } }]);
    expect(applied()).toEqual([]);
    await act(async () => {
      fireEvent.pointerUp(x, { clientX: 112 });
    });
    expect(applied()).toEqual([trial]);
  });

  it("押して離すと打ち込める（Enter で確定・Esc で取り消し・% は値に戻す）", async () => {
    const p = await selectLayer("T");
    const op = within(p).getByRole("spinbutton", { name: "不透明度" });
    fireEvent.pointerDown(op, { button: 0, clientX: 10 });
    fireEvent.pointerUp(op, { clientX: 10 });
    const input = within(p).getByRole("textbox", { name: "不透明度" });
    fireEvent.change(input, { target: { value: "40" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(applied()).toEqual([[{ op: "updateLayer", layerId: "T", patch: { transform: { opacity: { value: 0.4 } } } }]]);
    const rot = within(p).getByRole("spinbutton", { name: "回転" });
    fireEvent.pointerDown(rot, { button: 0, clientX: 10 });
    fireEvent.pointerUp(rot, { clientX: 10 });
    const r = within(p).getByRole("textbox", { name: "回転" });
    fireEvent.change(r, { target: { value: "90" } });
    fireEvent.keyDown(r, { key: "Escape" });
    expect(applied()).toHaveLength(1);
  });

  it("ストップウォッチで今の時刻に今の値のキーを打つ", async () => {
    const p = await selectLayer("T");
    await act(async () => {
      fireEvent.click(within(p).getByRole("button", { name: "回転のストップウォッチ" }));
    });
    expect(applied()).toEqual([
      [
        {
          op: "updateLayer",
          layerId: "T",
          patch: { transform: { rotation: { value: null, keyframes: [{ frame: 20, value: 0, interpolation: "linear" }] } } },
        },
      ],
    ]);
  });

  it("キーフレームの値を変えると今の時刻にキーを打ち、◀▶で前後のキーへ・◆で足す", async () => {
    const p = await selectLayer("A");
    const sw = within(p).getByRole("button", { name: "位置のストップウォッチ" });
    expect(sw.getAttribute("aria-pressed")).toBe("true");
    const y = within(p).getByRole("spinbutton", { name: "位置 y" });
    fireEvent.pointerDown(y, { button: 0, clientX: 0 });
    fireEvent.pointerMove(y, { clientX: 5 });
    await act(async () => {
      fireEvent.pointerUp(y, { clientX: 5 });
    });
    expect(applied()[0]).toEqual([
      {
        op: "updateLayer",
        layerId: "A",
        patch: {
          transform: {
            position: {
              keyframes: [
                { frame: 10, value: [0, 0], interpolation: "linear" },
                { frame: 20, value: [50, 5], interpolation: "linear" },
                { frame: 30, value: [100, 0], interpolation: "linear" },
              ],
            },
          },
        },
      },
    ]);
    fireEvent.click(within(p).getByRole("button", { name: "位置の前のキーへ" }));
    fireEvent.click(within(p).getByRole("button", { name: "位置の次のキーへ" }));
    const seeks = calls.filter((c) => c.cmd === "preview_seek").map((c) => c.args?.frame);
    expect(seeks).toEqual([10, 30]);
    expect(within(p).getByRole("button", { name: "位置のキーを足す・消す" }).getAttribute("aria-pressed")).toBe("false");
    // 動いていない値には◀◆▶を出さない
    expect(within(p).queryByRole("button", { name: "回転の前のキーへ" })).toBeNull();
  });

  it("タイムラインの帯の下に、キーのある時刻の◆を出す", async () => {
    render(<App />);
    await screen.findByTestId("bar-A");
    expect(screen.getByTestId("key-A-10")).toBeTruthy();
    expect(screen.getByTestId("key-A-30")).toBeTruthy();
    expect(screen.queryByTestId(/^key-T-/)).toBeNull();
  });

  it("錠のかかったレイヤーは見るだけ（数・ストップウォッチ・描画モードを直せない）", async () => {
    const p = await selectLayer("L");
    expect(within(p).getByText(/錠がかかっています/)).toBeTruthy();
    expect(within(p).getByRole("spinbutton", { name: "位置 x" }).getAttribute("aria-disabled")).toBe("true");
    expect((within(p).getByRole("button", { name: "位置のストップウォッチ" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(p).getByRole("combobox", { name: "描画モード" }) as HTMLSelectElement).disabled).toBe(true);
    const x = within(p).getByRole("spinbutton", { name: "位置 x" });
    fireEvent.pointerDown(x, { button: 0, clientX: 0 });
    fireEvent.pointerMove(x, { clientX: 30 });
    fireEvent.pointerUp(x, { clientX: 30 });
    expect(calls.filter((c) => c.cmd === "edit_trial" || c.cmd === "edit_apply")).toEqual([]);
  });

  it("描画モード・文・色も取引で直す", async () => {
    const p = await selectLayer("T");
    await act(async () => {
      fireEvent.change(within(p).getByRole("combobox", { name: "描画モード" }), { target: { value: "screen" } });
    });
    const text = within(p).getByRole("textbox", { name: "文" });
    fireEvent.change(text, { target: { value: "さようなら" } });
    await act(async () => {
      fireEvent.blur(text);
    });
    await act(async () => {
      fireEvent.change(within(p).getByLabelText("文字の色"), { target: { value: "#ff0000" } });
    });
    expect(applied()).toEqual([
      [{ op: "updateLayer", layerId: "T", patch: { blendMode: "screen" } }],
      [{ op: "updateLayer", layerId: "T", patch: { text: { text: "さようなら" } } }],
      [{ op: "updateLayer", layerId: "T", patch: { text: { fill: [1, 0, 0, 1] } } }],
    ]);
  });
});
