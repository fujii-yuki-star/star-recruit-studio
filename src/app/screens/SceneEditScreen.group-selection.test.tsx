// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #525-8（P1）：場面切替でグループ選択（activeGroupId）を持ち越すと、別場面が同名 group_001 を持つ場合に
// その場面のグループを誤って選択済みと見なす。selectScene で解除されることを確認する。
const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

// どの場面も同じ場面内採番 group_001 を持つ（groupOps は場面内一意＝別場面で id が衝突する）。
const freeScene = (id: string): Scene =>
  ({
    sceneId: id, partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" },
    freeLayout: [
      { id: "free_001", kind: "shape", x: 100, y: 100, w: 200, h: 200, zIndex: 1 },
      { id: "free_002", kind: "shape", x: 400, y: 100, w: 200, h: 200, zIndex: 2 },
    ],
    groups: [{ id: "group_001", members: ["free_001", "free_002"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
    warnings: [],
  }) as unknown as Scene;

describe("SceneEditScreen グループ選択は場面切替で持ち越さない（#525-8 P1）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: [freeTemplate],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      scenes: [freeScene("scene_001"), freeScene("scene_002")],
      assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("別場面（同名 group_001）へ切り替えるとグループ選択が解除される（誤選択しない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    // グループのメンバーを押す＝グループ単位で選択（onSelectGroup）→ グループツールバーが出る。
    const member = document.querySelector('[data-free-id="free_001"]') as HTMLElement | null;
    expect(member).toBeTruthy();
    fireEvent.pointerDown(member!, { button: 0, clientX: 150, clientY: 150, pointerId: 1 });
    expect(screen.getByText(/グループを選択中/)).toBeTruthy(); // 選択された

    // 別場面（同じく group_001 を持つ）へ切替＝場面ストリップの2枚目。
    const cards = Array.from(document.querySelectorAll(".scene-card"));
    expect(cards.length).toBe(2);
    fireEvent.click(cards[1]); // scene_002 を選ぶ

    // 持ち越さない＝新場面の group_001 を誤選択しない（ツールバーが消える）。
    expect(screen.queryByText(/グループを選択中/)).toBeNull();
  });
});
