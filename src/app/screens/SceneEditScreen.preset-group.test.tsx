// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #525-3：見た目パーツ（プリセット）を FREE に置くと、複数要素を最初から1つのグループにまとめて追加し、
// そのグループを選択状態にする（まとまりで移動/拡縮/回転できる）。グループ名はパーツ名。
const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

const emptyFreeScene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" },
    freeLayout: [], groups: [], warnings: [],
  }) as unknown as Scene;

describe("SceneEditScreen 見た目パーツは最初からグループ化して追加（#525-3）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: [freeTemplate],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [emptyFreeScene()],
      assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("パーツを追加すると要素がグループ化され、グループ（パーツ名）が選択される", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "数字カード" })); // 3要素のパーツ
    const scene = useProjectStore.getState().scenes[0];
    expect(scene.freeLayout?.length).toBe(3); // 3要素展開
    expect(scene.groups?.length).toBe(1); // 1グループ
    expect(scene.groups?.[0].members.length).toBe(3); // 3要素すべてがメンバー
    expect(scene.groups?.[0].name).toBe("数字カード"); // 名前はパーツ名（見分けやすさ）
    expect(screen.getByText(/グループを選択中/)).toBeTruthy(); // まとまりとして選択される
  });

  it("2つ追加すると別々のグループになり id は衝突しない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "吹き出し" })); // 2要素
    fireEvent.click(screen.getByRole("button", { name: "チェックリスト" })); // 3要素
    const scene = useProjectStore.getState().scenes[0];
    expect(scene.groups?.length).toBe(2);
    expect(scene.groups?.[0].id).not.toBe(scene.groups?.[1].id);
    expect(scene.freeLayout?.length).toBe(5); // 2 + 3
    // 各グループのメンバーは重複しない。
    const m0 = scene.groups?.[0].members ?? [], m1 = scene.groups?.[1].members ?? [];
    expect(m0.some((id) => m1.includes(id))).toBe(false);
  });
});
