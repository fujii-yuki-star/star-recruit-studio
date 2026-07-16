// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #525-5：グループのメンバーをダブルクリックすると、グループ選択を解除してそのメンバーだけを個別選択する（ドリルイン）。
// まとまり（グループ）と個別（メンバー）を行き来できる。実機経路＝素の pointerdown×2（互換 dblclick は来ない・#525-4）。
const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

const groupedScene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" },
    freeLayout: [
      { id: "free_001", kind: "shape", x: 100, y: 100, w: 200, h: 200, zIndex: 1 },
      { id: "free_002", kind: "shape", x: 400, y: 100, w: 200, h: 200, zIndex: 2 },
    ],
    groups: [{ id: "group_001", members: ["free_001", "free_002"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
    warnings: [],
  }) as unknown as Scene;

describe("SceneEditScreen グループメンバーのドリルイン選択（#525-5）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: [freeTemplate],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [groupedScene()],
      assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("メンバーをダブルクリックするとグループ選択が解除され、そのメンバーだけ選択される", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const member = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
    expect(member).toBeTruthy();
    // 1回押す＝グループ単位で選択（グループツールバーが出る）。
    fireEvent.pointerDown(member, { button: 0, clientX: 150, clientY: 150, pointerId: 1 });
    expect(screen.getByText(/グループを選択中/)).toBeTruthy();
    // メンバー上でダブルクリック（pointerdown×2）＝ドリルイン → グループ選択が解除される。
    fireEvent.pointerUp(member, { pointerId: 1 });
    fireEvent.pointerDown(member, { button: 0, clientX: 150, clientY: 150, pointerId: 1 });
    expect(screen.queryByText(/グループを選択中/)).toBeNull(); // まとまり選択から個別選択へ移った
    // ドリルインしたメンバーの詳細編集には「グループ内の値」注記が出る（数値が絶対座標に見える誤解を避ける・#525-5 レビュー）。
    expect(screen.getAllByText(/グループ内の要素です/).length).toBeGreaterThan(0);
  });
});
