// @vitest-environment jsdom
// レイヤー＋キーフレームの画面（MV-0014 ⑤-1）＝▸・U・キーを選ぶ／掴んで動かす／消す・開いたまま重なりの順を変える。
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
                layer("K", {
                  transform: {
                    anchor: { value: [0, 0] },
                    position: {
                      keyframes: [
                        { frame: 0, value: [0, 0], interpolation: "linear" },
                        { frame: 10, value: [100, 0], interpolation: "hold" },
                        { frame: 20, value: [50, 50], interpolation: "bezier" },
                      ],
                    },
                    scale: { value: [1, 1] },
                    rotation: {
                      keyframes: [
                        { frame: 5, value: 0, interpolation: "linear" },
                        { frame: 15, value: 90, interpolation: "linear" },
                      ],
                    },
                    opacity: { value: 1 },
                  },
                }),
                layer("B", { transform: { position: { value: [0, 0] } } }),
                layer("C"),
                layer("L", {
                  locked: true,
                  transform: { rotation: { keyframes: [{ frame: 3, value: 0, interpolation: "linear" }] } },
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
const trials = (): unknown[] => calls.filter((c) => c.cmd === "edit_trial").map((c) => c.args?.ops);

async function mount(): Promise<void> {
  render(<App />);
  await screen.findByTestId("bar-K");
  await act(async () => undefined);
}

function click(id: string, mods: { ctrlKey?: boolean } = {}): void {
  fireEvent.pointerDown(screen.getByTestId(`bar-${id}`), { button: 0, clientX: 50, ...mods });
  fireEvent.pointerUp(screen.getByTestId("timeline"), { clientX: 50 });
}

const POS = "/transform/position";
const ROT = "/transform/rotation";
const key = (id: string, path: string, f: number): HTMLElement => screen.getByTestId(`kf-${id}-${path}-${f}`);
const tl = (): HTMLElement => screen.getByTestId("timeline");

/** ◆を押して離す（動かさない）。 */
function pressKey(el: HTMLElement, x: number, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}): void {
  fireEvent.pointerDown(el, { button: 0, clientX: x, ...mods });
  fireEvent.pointerUp(tl(), { clientX: x });
}

async function openK(): Promise<void> {
  await mount();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "名前Kの値を開く" }));
  });
}

describe("レイヤー＋キーフレームの画面（MV-0014 ⑤-1）", () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(cleanup);

  it("▸で値の行を全部開き、もう一度で閉じる（値の行はレイヤーの下・◆の形は補間）", async () => {
    await mount();
    expect(screen.queryByTestId(`prop-row-K-${POS}`)).toBeNull();
    const twirl = screen.getByRole("button", { name: "名前Kの値を開く" });
    expect(twirl.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.click(twirl);
    });
    expect(twirl.getAttribute("aria-expanded")).toBe("true");
    const top = (id: string): number => parseInt(screen.getByTestId(id).style.top, 10);
    const rowH = top("prop-row-K-/transform/anchor") - top("row-K");
    expect(rowH).toBeGreaterThan(0);
    expect(top(`prop-row-K-${POS}`)).toBe(top("row-K") + 2 * rowH);
    // K の下に 5 つの値・B はその下
    expect(top("row-B")).toBe(top("row-K") + 6 * rowH);
    expect(screen.getByTestId(`prop-row-K-${POS}`).textContent).toContain("位置");
    expect(key("K", POS, 0).className).toContain("kf-linear");
    expect(key("K", POS, 10).className).toContain("kf-hold");
    expect(key("K", POS, 20).className).toContain("kf-bezier");
    await act(async () => {
      fireEvent.click(twirl);
    });
    expect(screen.queryByTestId(`prop-row-K-${POS}`)).toBeNull();
  });

  it("U＝選んだレイヤーのキーのある値だけ開く（キーの無いレイヤーは開かない）・もう一度で閉じる", async () => {
    await mount();
    click("K");
    click("B", { ctrlKey: true });
    await act(async () => {
      fireEvent.keyDown(window, { key: "u" });
    });
    expect(screen.getByTestId(`prop-row-K-${POS}`)).toBeTruthy();
    expect(screen.getByTestId(`prop-row-K-${ROT}`)).toBeTruthy();
    expect(screen.queryByTestId("prop-row-K-/transform/opacity")).toBeNull();
    expect(screen.queryByTestId(`prop-row-B-${POS}`)).toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: "u" });
    });
    expect(screen.queryByTestId(`prop-row-K-${POS}`)).toBeNull();
  });

  it("◆を押して選ぶ・Shift で足す・何も無い所で外す", async () => {
    await openK();
    pressKey(key("K", POS, 10), 10);
    expect(key("K", POS, 10).getAttribute("aria-pressed")).toBe("true");
    pressKey(key("K", ROT, 5), 5, { shiftKey: true });
    expect(key("K", POS, 10).getAttribute("aria-pressed")).toBe("true");
    expect(key("K", ROT, 5).getAttribute("aria-pressed")).toBe("true");
    const track = screen.getByTestId(`prop-row-K-${POS}`).querySelector(".tl-track") as HTMLElement;
    fireEvent.pointerDown(track, { button: 0, clientX: 50 });
    expect(key("K", POS, 10).getAttribute("aria-pressed")).toBe("false");
    expect(key("K", ROT, 5).getAttribute("aria-pressed")).toBe("false");
  });

  it("選んだキーをまとめて掴んで動かす＝試し・離すと1つの取引（動かした先のキーは置き換える）", async () => {
    await openK();
    pressKey(key("K", POS, 0), 0);
    pressKey(key("K", ROT, 5), 5, { shiftKey: true });
    // 選んでいる◆を素で掴んで 10 フレーム右へ（ppf 1）
    fireEvent.pointerDown(key("K", POS, 0), { button: 0, clientX: 0 });
    fireEvent.pointerMove(tl(), { clientX: 10 });
    const expected = [
      {
        op: "updateLayer",
        layerId: "K",
        patch: {
          transform: {
            position: {
              keyframes: [
                { frame: 10, value: [0, 0], interpolation: "linear" },
                { frame: 20, value: [50, 50], interpolation: "bezier" },
              ],
            },
            rotation: { keyframes: [{ frame: 15, value: 0, interpolation: "linear" }] },
          },
        },
      },
    ];
    expect(trials().at(-1)).toEqual(expected);
    // 動かしている途中も選んだまま見せる（動かした先で）
    expect(key("K", POS, 10).getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.pointerUp(tl(), { clientX: 10 });
    });
    expect(applied()).toEqual([expected]);
  });

  it("選んだ◆の1つを素で押して動かさずに離す＝それだけを選び直す（取引は無い）", async () => {
    await openK();
    pressKey(key("K", POS, 0), 0);
    pressKey(key("K", POS, 20), 20, { shiftKey: true });
    pressKey(key("K", POS, 20), 20);
    expect(key("K", POS, 20).getAttribute("aria-pressed")).toBe("true");
    expect(key("K", POS, 0).getAttribute("aria-pressed")).toBe("false");
    expect(applied()).toEqual([]);
  });

  it("Delete＝キーが選ばれていればレイヤーより先にキーを消す・そのあとはレイヤーを消す", async () => {
    await openK();
    click("K");
    pressKey(key("K", POS, 10), 10);
    await act(async () => {
      fireEvent.keyDown(window, { key: "Delete" });
    });
    expect(applied()).toEqual([
      [
        {
          op: "updateLayer",
          layerId: "K",
          patch: {
            transform: {
              position: {
                keyframes: [
                  { frame: 0, value: [0, 0], interpolation: "linear" },
                  { frame: 20, value: [50, 50], interpolation: "bezier" },
                ],
              },
            },
          },
        },
      ],
    ]);
    await act(async () => {
      fireEvent.keyDown(window, { key: "Delete" });
    });
    expect(applied()[1]).toEqual([{ op: "removeLayer", layerId: "K" }]);
  });

  it("錠のかかったレイヤーのキーは選べるが動かない", async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "名前Lの値を開く" }));
    });
    fireEvent.pointerDown(key("L", ROT, 3), { button: 0, clientX: 3 });
    fireEvent.pointerMove(tl(), { clientX: 13 });
    await act(async () => {
      fireEvent.pointerUp(tl(), { clientX: 13 });
    });
    expect(key("L", ROT, 3).getAttribute("aria-pressed")).toBe("true");
    expect(trials()).toEqual([]);
    expect(applied()).toEqual([]);
  });

  it("開いた値の行があっても、名前を掴んで行の数だけ下へ＝その行のレイヤーの位置へ", async () => {
    await openK();
    const top = (id: string): number => parseInt(screen.getByTestId(id).style.top, 10);
    const rowH = top("prop-row-K-/transform/anchor") - top("row-K");
    // K を下へ 7 行（値の行 5 つ＋B＋C）＝C の位置（並びの 2 番）
    const name = screen.getByTestId("row-K").querySelector(".tl-name") as HTMLElement;
    fireEvent.pointerDown(name, { button: 0, clientY: 0 });
    fireEvent.pointerMove(tl(), { clientY: 7 * rowH });
    await act(async () => {
      fireEvent.pointerUp(tl(), { clientY: 7 * rowH });
    });
    expect(applied()).toEqual([[{ op: "moveLayer", layerId: "K", index: 2 }]]);
  });
});

describe("補間の切り替え・J／K（MV-0014 ⑤-2）", () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(cleanup);

  const posAfter = (n: number): unknown => (applied()[n] as { patch: { transform: { position: unknown } } }[])[0].patch.transform.position;

  it("F9＝選んだキーをイージーイーズ（前の直線のキーは曲線に）・Shift+F9＝入り・Ctrl+Shift+F9＝出", async () => {
    await openK();
    pressKey(key("K", POS, 20), 20);
    await act(async () => {
      fireEvent.keyDown(window, { key: "F9" });
    });
    // 前（10）は止める＝変えない
    expect(posAfter(0)).toEqual({
      keyframes: [
        { frame: 0, value: [0, 0], interpolation: "linear" },
        { frame: 10, value: [100, 0], interpolation: "hold" },
        { frame: 20, value: [50, 50], interpolation: "bezier", easeOut: [1 / 3, 0], easeIn: [2 / 3, 1] },
      ],
    });
    pressKey(key("K", POS, 0), 0);
    await act(async () => {
      fireEvent.keyDown(window, { key: "F9", shiftKey: true });
    });
    expect(posAfter(1)).toEqual({
      keyframes: [
        { frame: 0, value: [0, 0], interpolation: "linear", easeIn: [2 / 3, 1] },
        { frame: 10, value: [100, 0], interpolation: "hold" },
        { frame: 20, value: [50, 50], interpolation: "bezier" },
      ],
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "F9", shiftKey: true, ctrlKey: true });
    });
    expect(posAfter(2)).toEqual({
      keyframes: [
        { frame: 0, value: [0, 0], interpolation: "bezier", easeOut: [1 / 3, 0] },
        { frame: 10, value: [100, 0], interpolation: "hold" },
        { frame: 20, value: [50, 50], interpolation: "bezier" },
      ],
    });
    // Ctrl+F9 は何もしない
    await act(async () => {
      fireEvent.keyDown(window, { key: "F9", ctrlKey: true });
    });
    expect(applied()).toHaveLength(3);
  });

  it("Ctrl+Alt+H＝止める⇔直線・Ctrl を押しながら◆＝直線に戻す（選択は変えない）", async () => {
    await openK();
    pressKey(key("K", POS, 0), 0);
    await act(async () => {
      fireEvent.keyDown(window, { key: "h", ctrlKey: true, altKey: true });
    });
    expect(posAfter(0)).toEqual({
      keyframes: [
        { frame: 0, value: [0, 0], interpolation: "hold" },
        { frame: 10, value: [100, 0], interpolation: "hold" },
        { frame: 20, value: [50, 50], interpolation: "bezier" },
      ],
    });
    await act(async () => {
      fireEvent.pointerDown(key("K", POS, 20), { button: 0, clientX: 20, ctrlKey: true });
    });
    expect(posAfter(1)).toEqual({
      keyframes: [
        { frame: 0, value: [0, 0], interpolation: "linear" },
        { frame: 10, value: [100, 0], interpolation: "hold" },
        { frame: 20, value: [50, 50], interpolation: "linear" },
      ],
    });
    expect(key("K", POS, 0).getAttribute("aria-pressed")).toBe("true");
    expect(key("K", POS, 20).getAttribute("aria-pressed")).toBe("false");
  });

  it("キーが選ばれていなければ、補間のキーは何も送らない", async () => {
    await openK();
    await act(async () => {
      fireEvent.keyDown(window, { key: "F9" });
      fireEvent.keyDown(window, { key: "h", ctrlKey: true, altKey: true });
    });
    expect(applied()).toEqual([]);
  });

  it("J／K＝前／次のキーへ（選んだレイヤー・無ければ全部）", async () => {
    await mount();
    const seeks = (): unknown[] => calls.filter((c) => c.cmd === "preview_seek").map((c) => c.args?.frame);
    await act(async () => {
      fireEvent.keyDown(window, { key: "k" });
    });
    // 全部＝L の 3 がいちばん近い
    expect(seeks()).toEqual([3]);
    click("K");
    await act(async () => {
      fireEvent.keyDown(window, { key: "k" });
    });
    expect(seeks()).toEqual([3, 5]);
    // 前は無い＝動かさない
    await act(async () => {
      fireEvent.keyDown(window, { key: "j" });
    });
    expect(seeks()).toEqual([3, 5]);
  });
});
