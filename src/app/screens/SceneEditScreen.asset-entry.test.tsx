// @vitest-environment jsdom
// 場面編集の素材タイルが「見える入口」になっている（#1030 ①③④）。
//
// ⚠️ **押しても何も起きない一覧だった**＝タイルは表示専用で、差し替えは右欄の**畳まれた**節の中の
// 名前の `<select>` だけ＝画面1面ぶんが「押せそうに見えて何も起きない」で埋まっていた
// （ADR-0034 決定5・`06 §2-5`）。AI 生成動画を直す**最頻の操作**がここ。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

const template = {
  schemaVersion: "1.0", templateId: "tmpl_a", name: "本文", category: "body", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [
    { id: "main", type: "slot", slotType: "image", x: 0, y: 0, w: 960, h: 1080, zIndex: 1 },
    { id: "sub", type: "slot", slotType: "image", x: 960, y: 0, w: 960, h: 1080, zIndex: 2 },
  ],
} as unknown as Template;

const scene = (assetRefs: Record<string, string> = {}): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "body", templateId: "tmpl_a",
    durationSec: 8, assetRefs, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  }) as unknown as Scene;

const asset = (assetId: string, displayName: string, assetType = "image") =>
  ({ assetId, assetType, displayName, filePath: `${assetId}.png` }) as never;

function setup(assetRefs: Record<string, string> = {}) {
  useProjectStore.setState({
    templates: [template],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [scene(assetRefs)],
    assets: [asset("asset_001", "外観"), asset("asset_002", "社員"), asset("asset_003", "BGM", "bgm")],
    editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
}

const tile = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
const refs = () => useProjectStore.getState().scenes[0].assetRefs;

beforeEach(() => {
  vi.restoreAllMocks();
  setup();
});

describe("素材タイルから差し込み口へ入れられる（#1030 ①）", () => {
  it("押すと、空いている差し込み口へ入る", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(tile("外観"));
    expect(refs().main).toBe("asset_001");
  });

  it("2枚目は次の空いている差し込み口へ入る", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(tile("外観"));
    fireEvent.click(tile("社員"));
    expect(refs()).toMatchObject({ main: "asset_001", sub: "asset_002" });
  });

  // ⚠️ **空きが無いときに黙って置き換えない**（§2-5・`06 §2` 規約1）。
  it("空きが無いときは、入れ替える前に確認を出す", () => {
    setup({ main: "asset_001", sub: "asset_002" });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(tile("社員"));
    expect(refs().main, "確認の前に入れ替えている").toBe("asset_001");
    expect(screen.getByText(/入れ替えますか/)).toBeInTheDocument();
  });

  it("確認で「入れ替える」を押すと入れ替わる", () => {
    setup({ main: "asset_001", sub: "asset_002" });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(tile("社員"));
    fireEvent.click(screen.getByRole("button", { name: "入れ替える" }));
    expect(refs().main).toBe("asset_002");
  });

  it("確認で「やめる」を押すと何も変わらない", () => {
    setup({ main: "asset_001", sub: "asset_002" });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(tile("社員"));
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(refs().main).toBe("asset_001");
    expect(screen.queryByText(/入れ替えますか/)).toBeNull();
  });

  // ⚠️ **入れられない素材は押せなくし、理由を出す**（押せるのに効かない、を作らない）。
  it("入れられない素材（音）は押せず、理由が出る", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const bgm = tile("BGM");
    expect(bgm).toBeDisabled();
    expect(bgm).toHaveAttribute("title", expect.stringContaining("入れられる場所"));
  });
});

describe("素材タイルの見た目（#1030 ③）", () => {
  // ⚠️ **絵で選べるようにする**＝種別アイコンだけだと、同じ種類の写真が並ぶと名前でしか区別できない。
  it("絵があるときは絵を出す（素材画面と同じ部品）", () => {
    useProjectStore.setState({ assetSrcById: { asset_001: "asset://a.png" } });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(within(tile("外観")).getByRole("presentation", { hidden: true })).toHaveAttribute("src", "asset://a.png");
  });
});

describe("使用素材の節（#1030 ④）", () => {
  /**
   * 「使用素材」の節が**開いて出ているか**。
   *
   * ⚠️ **中身の有無では見ない**＝`<details>` は畳んでいても子を DOM に残す（jsdom では
   * `toBeVisible()` も `details` を見ない）ので、`queryAllByText` は畳んでいても当たる。
   * **`open` 属性**で見る。
   */
  const assetsSectionOpen = (): boolean =>
    screen.getByText("使用素材").closest("details")?.hasAttribute("open") ?? false;

  // ⚠️ **警告は出るのに直す欄が畳まれていた**＝次の行動が見えていない（`06 §2-5`）。
  it("入っていない差し込み口があるときは、開いた状態で出す", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(assetsSectionOpen(), "空きがあるのに畳まれている").toBe(true);
  });

  it("全部埋まっているときは畳んで出す（要らない節を開いたままにしない）", () => {
    setup({ main: "asset_001", sub: "asset_002" });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(assetsSectionOpen(), "全部埋まっているのに開いている").toBe(false);
  });
});
