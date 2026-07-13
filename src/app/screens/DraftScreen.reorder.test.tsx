// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { DraftScreen } from "./DraftScreen";

// #398 再対応：たたき台の台本表も同じ useDragReorder を使う。フックを Pointer Events 版へ置換したので、
// 行の持ち手（⠿）を実操作して store の並びが変わることを固定する（共有フックの回帰防止）。
function scene(id: string, order: number): Scene {
  return {
    sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  };
}

describe("DraftScreen 台本表の並び替え（Pointer Events・#398 再対応）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002", "scene_003"] }],
      scenes: [scene("scene_001", 1), scene("scene_002", 2), scene("scene_003", 3)],
      status: "ready", warnings: [], saveStatus: "saved",
    });
  });

  it("先頭行の持ち手を3行目へドラッグすると store の並びが [002,003,001] になる", () => {
    render(<DraftScreen onNavigate={vi.fn()} />);
    const gripRows = [...document.querySelectorAll("tbody tr")];
    expect(gripRows).toHaveLength(3);
    const grip = [...gripRows[0].querySelectorAll("span")].find((s) => s.textContent === "⠿");
    expect(grip).toBeTruthy();

    fireEvent.pointerDown(grip as HTMLElement, { button: 0 });
    fireEvent.pointerMove(gripRows[2]); // 3行目（index 2）へ重ねる
    fireEvent.pointerUp(window);

    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual([
      "scene_002", "scene_003", "scene_001",
    ]);
  });
});
