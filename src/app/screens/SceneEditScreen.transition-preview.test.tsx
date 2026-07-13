// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #408 Part 2：場面編集の「切り替えを見る」ボタンの表示条件（先頭場面/none で非表示・遷移ありで表示）と、
// 押下でオーバーレイ再生（停止表示）になる配線を固定する（画面上のボタン/オーバーレイ経路の未検証を解消）。
function scene(id: string, order: number, over: Partial<Scene> = {}): Scene {
  return {
    sceneId: id, partId: "part_001", order, sceneType: "opening",
    templateId: "opening_yuko_right_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [], ...over,
  };
}

const setup = (editingSceneId: string, scenes: Scene[]) => {
  useProjectStore.setState({
    templates: sampleTemplates,
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: scenes.map((s) => s.sceneId) }],
    scenes, assets: [], editingSceneId,
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
};

describe("SceneEditScreen 切替効果プレビュー（#408 Part 2）", () => {
  beforeEach(() => {
    setup("scene_001", [scene("scene_001", 1)]);
  });

  it("先頭場面は「切り替えを見る」ボタンを出さない（前からの切り替えが無い）", () => {
    setup("scene_001", [scene("scene_001", 1), scene("scene_002", 2, { transition: { in: "fade", durationSec: 0.5 } })]);
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("切り替えを見る")).toBeNull();
  });

  it("切替効果が none の場面は「切り替えを見る」を出さない", () => {
    setup("scene_002", [scene("scene_001", 1), scene("scene_002", 2, { transition: { in: "none" } })]);
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("切り替えを見る")).toBeNull();
  });

  it("2番目以降で切替効果あり＝「切り替えを見る」を出し、押すと再生（停止表示）になる", () => {
    setup("scene_002", [scene("scene_001", 1), scene("scene_002", 2, { transition: { in: "fade", durationSec: 0.5 } })]);
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const btn = screen.getByText("切り替えを見る");
    fireEvent.click(btn);
    // 再生中＝ボタンは「停止」。オーバーレイ（TransitionPreview の2枚重ね＝aria-hidden SVG）が描かれる。
    expect(screen.getByText("停止")).toBeTruthy();
  });
});
