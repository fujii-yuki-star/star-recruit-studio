// @vitest-environment jsdom
// プレビューで掴む・素材の一覧（MV-0008 ⑧-3）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const handlers: Record<string, (p: unknown) => void> = {};
const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
let picked: string[] = [];

const comp = { id: "cmp_A", name: "本編", width: 640, height: 360, fps: { num: 30, den: 1 }, durationFrames: 300 };
const tf = (x: number, y: number): unknown => ({
  anchor: { value: [0, 0] },
  position: { value: [x, y] },
  scale: { value: [1, 1] },
  rotation: { value: 0 },
  opacity: { value: 1 },
});
const solid = (id: string, locked = false): unknown => ({
  id,
  name: `名前${id}`,
  type: "solid",
  enabled: true,
  locked,
  inFrame: 0,
  outFrame: 100,
  startFrame: 0,
  solid: { color: [1, 0, 0, 1], width: 10, height: 10 },
  transform: tf(100, 50),
});
const asset = { id: "ast_V", kind: "video", name: "海.mp4", sha256: "f".repeat(64), meta: { width: 640, height: 360, durationSec: 2 } };

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
          assets: [asset],
          compositions: [{ ...comp, markers: [], layers: [solid("FRONT"), solid("BACK"), solid("LOCK", true)] }],
        },
      };
    if (cmd === "edit_apply") return { applied: true, revision: "r2", reapplied: false, created: [] };
    if (cmd === "edit_eval") return { "/transform/position": [100, 50] };
    if (cmd === "pick_asset_files") return picked;
    if (cmd === "preview_bounds")
      // 欄は jsdom では左上 (0,0)・画素比 1。窓の画素＝欄の画素。コンポジション 1 画素＝窓 0.5 画素。
      return {
        frame: 0,
        scale: 0.5,
        layers: [
          { layerId: "LOCK", corners: [[0, 0], [400, 0], [400, 400], [0, 400]] },
          { layerId: "FRONT", corners: [[10, 10], [30, 10], [30, 30], [10, 30]] },
          { layerId: "BACK", corners: [[0, 0], [200, 0], [200, 200], [0, 200]] },
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

const { App, placeAssetOp } = await import("./App");

const applied = (): unknown[] => calls.filter((c) => c.cmd === "edit_apply").map((c) => c.args?.ops);

async function mount(): Promise<HTMLElement> {
  render(<App />);
  await screen.findByTestId("bar-FRONT");
  const ov = screen.getByTestId("preview-overlay");
  await waitFor(() => expect(calls.some((c) => c.cmd === "preview_bounds")).toBe(true));
  // 枠の答えが届くのを待つ
  await act(async () => undefined);
  return ov;
}

describe("プレビューで掴む（MV-0008 決定6）", () => {
  beforeEach(() => {
    calls.length = 0;
    picked = [];
  });
  afterEach(cleanup);

  it("押した所のいちばん手前のレイヤーを選び（錠は飛ばす）、その枠を描く・何も無い所は選択を外す", async () => {
    const ov = await mount();
    fireEvent.pointerDown(ov, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(ov, { clientX: 20, clientY: 20 });
    expect(screen.getByTestId("layer-props").textContent).toContain("名前FRONT");
    const box = await screen.findByTestId("selection-box");
    expect(box.querySelector("polygon")?.getAttribute("points")).toBe("10,10 30,10 30,30 10,30");
    fireEvent.pointerDown(ov, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(ov, { clientX: 100, clientY: 100 });
    expect(screen.getByTestId("layer-props").textContent).toContain("名前BACK");
    fireEvent.pointerDown(ov, { button: 0, clientX: 300, clientY: 300 }); // 錠のレイヤーだけの所
    fireEvent.pointerUp(ov, { clientX: 300, clientY: 300 });
    expect(screen.queryByTestId("layer-props")).toBeNull();
    expect(screen.queryByTestId("selection-box")).toBeNull();
  });

  it("掴んで動かすと試しを送り、離すと位置を1つの取引で（欄の画素÷倍率＝コンポジションの画素・Shift で片方だけ）", async () => {
    const ov = await mount();
    fireEvent.pointerDown(ov, { button: 0, clientX: 20, clientY: 20 });
    await act(async () => undefined); // 掴んだときの位置を Rust に求めてもらう
    fireEvent.pointerMove(ov, { clientX: 25, clientY: 22 });
    expect(calls.filter((c) => c.cmd === "edit_trial").at(-1)?.args?.ops).toEqual([
      { op: "updateLayer", layerId: "FRONT", patch: { transform: { position: { value: [110, 54] } } } },
    ]);
    // 枠も一緒に動く（CSS 画素で 5・2）
    expect(screen.getByTestId("selection-box").querySelector("polygon")?.getAttribute("points")).toBe(
      "15,12 35,12 35,32 15,32",
    );
    fireEvent.pointerMove(ov, { clientX: 25, clientY: 22, shiftKey: true });
    await act(async () => {
      fireEvent.pointerUp(ov, { clientX: 25, clientY: 22 });
    });
    expect(applied()).toEqual([
      [{ op: "updateLayer", layerId: "FRONT", patch: { transform: { position: { value: [110, 50] } } } }],
    ]);
  });

  it("再生中は枠を出さず、掴めない", async () => {
    const ov = await mount();
    fireEvent.pointerDown(ov, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(ov, { clientX: 20, clientY: 20 });
    await screen.findByTestId("selection-box");
    act(() => handlers["preview-status"]({ compositionId: "cmp_A", frame: 3, playing: true, fps: 30, dropped: 0 }));
    expect(screen.queryByTestId("selection-box")).toBeNull();
    fireEvent.pointerDown(ov, { button: 0, clientX: 100, clientY: 100 });
    expect(screen.getByTestId("layer-props").textContent).toContain("名前FRONT");
  });
});

describe("素材の一覧（MV-0008 決定7）", () => {
  beforeEach(() => {
    calls.length = 0;
    picked = [];
  });
  afterEach(cleanup);

  it("種類・大きさ・長さ・指紋を並べ、「取り込む…」で選んだファイルを写して取り込む", async () => {
    await mount();
    const row = screen.getByTestId("asset-ast_V");
    expect(row.textContent).toContain("映像");
    expect(row.textContent).toContain("640×360・2.0 秒・指紋あり");
    picked = ["D:/外/a.png", "D:/外/b.mp4"];
    await act(async () => {
      fireEvent.click(within(screen.getByLabelText("素材の一覧")).getByRole("button", { name: "取り込む…" }));
    });
    await waitFor(() => expect(applied()).toHaveLength(1));
    expect(applied()[0]).toEqual([
      { op: "importAsset", path: "D:/外/a.png", mode: "copy" },
      { op: "importAsset", path: "D:/外/b.mp4", mode: "copy" },
    ]);
  });

  it("選ばなければ何もしない", async () => {
    await mount();
    await act(async () => {
      fireEvent.click(within(screen.getByLabelText("素材の一覧")).getByRole("button", { name: "取り込む…" }));
    });
    expect(applied()).toEqual([]);
  });

  it("タイムラインへ運ぶと、落とした時刻からいちばん手前に置く（線で落とす所を見せる）", async () => {
    await mount();
    const ruler = screen.getByTestId("ruler");
    ruler.getBoundingClientRect = () => ({ left: 300, top: 0, width: 600, height: 20, right: 900, bottom: 20, x: 300, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(screen.getByTestId("asset-ast_V"), { button: 0, clientX: 10, clientY: 10 });
    const tl = screen.getByTestId("timeline");
    fireEvent.pointerMove(tl, { clientX: 340 });
    expect(screen.getByTestId("drop-line")).toBeTruthy();
    await act(async () => {
      fireEvent.pointerUp(tl, { clientX: 340 });
      window.dispatchEvent(new Event("pointerup"));
    });
    expect(applied()).toEqual([[placeAssetOp(asset as never, 40, "cmp_A")]]);
    expect(applied()[0]).toEqual([
      { op: "addLayer", compositionId: "cmp_A", index: 0, layer: { name: "海.mp4", assetId: "ast_V", inFrame: 40 } },
    ]);
    // 運び終えたら、タイムラインを押しても置かない
    expect(screen.queryByTestId("drop-line")).toBeNull();
  });

  it("タイムラインの外で離したら置かない・「置く」は今の時刻に置く", async () => {
    await mount();
    fireEvent.pointerDown(screen.getByTestId("asset-ast_V"), { button: 0, clientX: 10, clientY: 10 });
    await act(async () => {
      window.dispatchEvent(new Event("pointerup"));
    });
    fireEvent.pointerUp(screen.getByTestId("timeline"), { clientX: 340 });
    expect(applied()).toEqual([]);
    act(() => handlers["preview-status"]({ compositionId: "cmp_A", frame: 12, playing: false, fps: 0, dropped: 0 }));
    await act(async () => {
      fireEvent.click(within(screen.getByTestId("asset-ast_V")).getByRole("button", { name: "置く" }));
    });
    expect(applied()).toEqual([
      [{ op: "addLayer", compositionId: "cmp_A", index: 0, layer: { name: "海.mp4", assetId: "ast_V", inFrame: 12 } }],
    ]);
  });
});
