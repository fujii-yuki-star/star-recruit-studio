// @vitest-environment jsdom
// 編集画面（MV-0008 ⑧-1）＝画面の操作は取引として Rust へ送り（外部 AI と同じ道）、掴んでいる途中は試しだけ。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { REAPPLIED_NOTICE } from "./edit/useEditor";

const handlers: Record<string, (p: unknown) => void> = {};
const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
let applyReply: () => unknown = () => ({ applied: true, revision: "r2", reapplied: false, created: [] });
let reads = 0;

const comp = {
  id: "cmp_A",
  name: "本編",
  width: 1920,
  height: 1080,
  fps: { num: 30, den: 1 },
  durationFrames: 300,
};
const layer = (id: string, inFrame: number, outFrame: number, extra: Record<string, unknown> = {}): unknown => ({
  id,
  name: `名前${id}`,
  type: "solid",
  enabled: true,
  locked: false,
  inFrame,
  outFrame,
  startFrame: inFrame,
  ...extra,
});
const doc = (): unknown => ({
  revision: `r${reads}`,
  project: {
    name: "見本",
    mainCompositionId: "cmp_A",
    assets: [{ id: "ast_1", kind: "video", name: "海.mp4" }],
    compositions: [
      { ...comp, markers: [], layers: [layer("A", 0, 100), layer("B", 100, 200), layer("C", 200, 300)] },
    ],
  },
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "initial_project") return "C:/v";
    if (cmd === "open_project")
      return { dir: "C:/v", name: "見本", mainCompositionId: "cmp_A", compositions: [comp], issues: [] };
    if (cmd === "edit_read") {
      reads += 1;
      return doc();
    }
    if (cmd === "edit_apply") {
      const r = applyReply();
      if (r instanceof Error) throw r.message;
      return r;
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

async function mount(): Promise<void> {
  render(<App />);
  await screen.findByTestId("bar-A");
}

const applied = (): { ops: unknown; baseRevision: unknown }[] =>
  calls.filter((c) => c.cmd === "edit_apply").map((c) => ({ ops: c.args?.ops, baseRevision: c.args?.baseRevision }));

/** jsdom は大きさを持たない＝帯の矩形を与える（端の 6 画素で切る・それ以外でずらす）。 */
function sizeBar(id: string, width = 100): HTMLElement {
  const bar = screen.getByTestId(`bar-${id}`);
  bar.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 20, right: width, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
  return bar;
}

describe("編集画面（MV-0008 ⑧-1）", () => {
  beforeEach(() => {
    calls.length = 0;
    reads = 0;
    applyReply = () => ({ applied: true, revision: "r2", reapplied: false, created: [] });
  });
  afterEach(cleanup);

  it("タイムラインにレイヤーを並べ（先頭が上）、素材の一覧も出す", async () => {
    await mount();
    const rows = screen.getAllByTestId(/^row-/).map((r) => r.getAttribute("data-testid"));
    expect(rows).toEqual(["row-A", "row-B", "row-C"]);
    expect(within(screen.getByLabelText("素材の一覧")).getByText(/海\.mp4/)).toBeTruthy();
  });

  it("帯を押すと選ばれ、値の欄にそのレイヤーが出る（Ctrl で足す・Shift で範囲）", async () => {
    await mount();
    fireEvent.pointerDown(sizeBar("A"), { button: 0, clientX: 50 });
    fireEvent.pointerUp(screen.getByTestId("timeline"), { clientX: 50 });
    expect(screen.getByTestId("layer-props").textContent).toContain("名前A");
    fireEvent.pointerDown(sizeBar("C"), { button: 0, clientX: 50, shiftKey: true });
    fireEvent.pointerUp(screen.getByTestId("timeline"), { clientX: 50 });
    expect(screen.getByLabelText("値の欄").textContent).toContain("3 個のレイヤーを選んでいます");
    fireEvent.pointerDown(sizeBar("B"), { button: 0, clientX: 50, ctrlKey: true });
    fireEvent.pointerUp(screen.getByTestId("timeline"), { clientX: 50 });
    expect(screen.getByLabelText("値の欄").textContent).toContain("2 個のレイヤーを選んでいます");
  });

  it("帯を掴んで動かす間は試しだけ送り、離したら1つの取引で保存する（見ていた版を付ける）", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "吸着" })); // 吸着を切って、動かした量そのままを見る
    const tl = screen.getByTestId("timeline");
    fireEvent.pointerDown(sizeBar("B"), { button: 0, clientX: 50 });
    fireEvent.pointerMove(tl, { clientX: 60 });
    fireEvent.pointerMove(tl, { clientX: 70 });
    const trials = calls.filter((c) => c.cmd === "edit_trial").map((c) => c.args?.ops);
    expect(trials).toEqual([
      [{ op: "updateLayer", layerId: "B", patch: { inFrame: 110, outFrame: 210, startFrame: 110 } }],
      [{ op: "updateLayer", layerId: "B", patch: { inFrame: 120, outFrame: 220, startFrame: 120 } }],
    ]);
    expect(applied()).toEqual([]);
    await act(async () => {
      fireEvent.pointerUp(tl, { clientX: 70 });
    });
    expect(applied()).toEqual([
      {
        ops: [{ op: "updateLayer", layerId: "B", patch: { inFrame: 120, outFrame: 220, startFrame: 120 } }],
        baseRevision: "r1",
      },
    ]);
    expect(reads).toBe(2); // 保存したら読み直す
  });

  it("吸着は既定で入っていて、ほかのレイヤーの端へ吸い付く（S で切り替え）", async () => {
    await mount();
    const tl = screen.getByTestId("timeline");
    expect(screen.getByRole("button", { name: "吸着" }).getAttribute("aria-pressed")).toBe("true");
    // B（100〜200）を 3 フレーム右へ＝始まり 103 は A の終わり 100 から 3 画素（ppf=1）＝吸い付いて 100 のまま
    fireEvent.pointerDown(sizeBar("B"), { button: 0, clientX: 50 });
    fireEvent.pointerMove(tl, { clientX: 53 });
    expect(calls.filter((c) => c.cmd === "edit_trial")).toEqual([]);
    await act(async () => {
      fireEvent.pointerUp(tl, { clientX: 53 });
    });
    expect(applied()).toEqual([]);
    fireEvent.keyDown(window, { key: "s" });
    expect(screen.getByRole("button", { name: "吸着" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("帯の端を掴むと、その端だけ動く（切る）", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "吸着" }));
    const tl = screen.getByTestId("timeline");
    fireEvent.pointerDown(sizeBar("B"), { button: 0, clientX: 98 }); // 右の端（幅 100 の 98）
    fireEvent.pointerMove(tl, { clientX: 88 });
    await act(async () => {
      fireEvent.pointerUp(tl, { clientX: 88 });
    });
    expect(applied()[0].ops).toEqual([{ op: "updateLayer", layerId: "B", patch: { outFrame: 190 } }]);
  });

  it("キー：今の時刻で分割・消す・消して詰める（選んだレイヤー・今の時刻）", async () => {
    await mount();
    act(() => handlers["preview-status"]({ compositionId: "cmp_A", frame: 150, playing: false, fps: 0, dropped: 0 }));
    fireEvent.pointerDown(sizeBar("B"), { button: 0, clientX: 50 });
    fireEvent.pointerUp(screen.getByTestId("timeline"), { clientX: 50 });
    await act(async () => {
      fireEvent.keyDown(window, { key: "D", ctrlKey: true, shiftKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Delete", shiftKey: true });
    });
    expect(applied().map((a) => a.ops)).toEqual([
      [{ op: "splitLayer", layerId: "B", frame: 150 }],
      [
        { op: "removeLayer", layerId: "B" },
        { op: "updateLayer", layerId: "C", patch: { inFrame: 100, outFrame: 200, startFrame: 100 } },
      ],
    ]);
    // 2つ目の取引は、1つ目の保存のあとの版で送る（前の版で送らない）
    expect(applied()[1].baseRevision).toBe("r2");
  });

  it("Ctrl+A で全部選び、目・ソロ・錠の切り替えと名前の変更も取引で送る", async () => {
    await mount();
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(screen.getByLabelText("値の欄").textContent).toContain("3 個のレイヤーを選んでいます");
    const row = screen.getByTestId("row-A");
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "表示" }));
    });
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "錠" }));
    });
    fireEvent.doubleClick(within(row).getByText("名前A"));
    const input = within(screen.getByTestId("row-A")).getByLabelText("レイヤーの名前");
    fireEvent.change(input, { target: { value: "海の映像" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(applied().map((a) => a.ops)).toEqual([
      [{ op: "updateLayer", layerId: "A", patch: { enabled: false } }],
      [{ op: "updateLayer", layerId: "A", patch: { locked: true } }],
      [{ op: "updateLayer", layerId: "A", patch: { name: "海の映像" } }],
    ]);
  });

  it("断られたら理由を出し（何も変えていない）、当て直したら知らせる", async () => {
    await mount();
    applyReply = () => new Error("この操作は反映していません：コンポジションより前です");
    fireEvent.pointerDown(sizeBar("A"), { button: 0, clientX: 50 });
    fireEvent.pointerUp(screen.getByTestId("timeline"), { clientX: 50 });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Delete" });
    });
    expect(screen.getByRole("alert").textContent).toContain("コンポジションより前です");
    applyReply = () => ({ applied: true, revision: "r9", reapplied: true, created: [] });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Delete" });
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(REAPPLIED_NOTICE)).toBeTruthy();
  });

  it("外（AI）の変更を受けたら、編集に使う中身も読み直す", async () => {
    await mount();
    const before = reads;
    await act(async () => {
      handlers["project-changed"]({ dir: "C:/v", name: "見本", mainCompositionId: "cmp_A", compositions: [comp], issues: [] });
    });
    expect(reads).toBe(before + 1);
  });
});
