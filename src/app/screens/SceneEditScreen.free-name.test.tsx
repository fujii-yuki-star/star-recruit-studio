// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #525-12：FREE 要素に任意の表示名を付けられる（重ね順一覧でインライン改名・グループ名＝#9 と同じ UX）。
// 未設定は「種類＋連番」の自動名にフォールバック。改名は Undo 可（patchFreeEl 経由）。
// 表示名は一覧・チップ・詳細見出しの複数箇所に出るため getAllByText で照合する。
const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

// free_001＝図形(zIndex 2・一覧で上)、free_002＝文字(zIndex 1)。freeLayout の並び順で自動名は「図形1」「文字2」。
const freeScene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" },
    freeLayout: [
      { id: "free_001", kind: "shape", x: 100, y: 100, w: 200, h: 200, zIndex: 2 },
      { id: "free_002", kind: "text", x: 400, y: 100, w: 200, h: 80, zIndex: 1, text: "見出し" },
    ],
    warnings: [],
  }) as unknown as Scene;

describe("SceneEditScreen FREE 要素の命名（#525-12）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: [freeTemplate],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [freeScene()],
      assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  const freeOf = (id: string) => useProjectStore.getState().scenes[0].freeLayout?.find((e) => e.id === id);
  // 一覧は zIndex 降順＝先頭行が free_001。「名前を変更」ボタンは一覧行のみに出る（先頭が free_001）。
  const clickRenameFirst = () => fireEvent.click(screen.getAllByRole("button", { name: "名前を変更" })[0]);

  it("名前未設定なら種類＋連番の自動名を出す（図形1／文字2）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByText(/図形1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/文字2/).length).toBeGreaterThan(0);
  });

  it("「名前」ボタン→入力→Enter で name を保存し、表示が変わる", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    clickRenameFirst();
    const input = screen.getByLabelText("要素名") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "背景の四角" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(freeOf("free_001")?.name).toBe("背景の四角");
    expect(screen.getAllByText(/背景の四角/).length).toBeGreaterThan(0); // 自動名でなく付けた名前が出る
  });

  it("ダブルクリックでも改名に入れる", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    // 一覧行の名前ボタン（ダブルクリックで改名）を狙う＝title で特定・先頭が free_001。
    fireEvent.doubleClick(screen.getAllByTitle(/ダブルクリックで名前を変更/)[0]);
    const input = screen.getByLabelText("要素名") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "四角A" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(freeOf("free_001")?.name).toBe("四角A");
  });

  it("空文字で確定すると name を外して自動名へ戻す", () => {
    useProjectStore.setState((s) => ({
      scenes: s.scenes.map((sc) => sc.sceneId === "scene_001"
        ? { ...sc, freeLayout: sc.freeLayout?.map((e) => e.id === "free_001" ? { ...e, name: "四角A" } : e) }
        : sc),
    }));
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByText(/四角A/).length).toBeGreaterThan(0);
    clickRenameFirst();
    const input = screen.getByLabelText("要素名") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  " } }); // 空白のみ＝クリア
    fireEvent.keyDown(input, { key: "Enter" });
    expect(freeOf("free_001")?.name).toBeUndefined(); // name を外す
    expect(screen.getAllByText(/図形1/).length).toBeGreaterThan(0); // 自動名へ戻る
  });

  it("Escape で改名をキャンセルする（name は変わらない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    clickRenameFirst();
    const input = screen.getByLabelText("要素名") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "捨てる" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(freeOf("free_001")?.name).toBeUndefined(); // 反映しない
    expect(screen.queryByLabelText("要素名")).toBeNull(); // 入力は閉じる
  });
});
