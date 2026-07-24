// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #547 P3-12：書き出し中は store の undo/redo が無言 no-op ＝「取り消す/やり直す」ボタンも disabled にする（ADR-0026④）。
// 配線（disabled={isExporting}）が場面編集からも外れないよう機械的に固定する（DraftScreen・TimelineEditScreen と同種のガード）。
function scene(id: string, order: number): Scene {
  return {
    sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  };
}

describe("SceneEditScreen 取り消す/やり直すの書き出し中無効化（#547 P3-12）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene("scene_001", 1)],
      assets: [],
      editingSceneId: "scene_001",
      past: [{} as never], future: [{} as never], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("履歴があり非書き出し時は取り消す/やり直すが有効", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "取り消す" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "やり直す" })).not.toBeDisabled();
  });

  it("書き出し中は履歴があっても取り消す/やり直すを無効にする（store は無言 no-op・ADR-0026④）", () => {
    useProjectStore.getState().setExportRun({ phase: "rendering" });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "取り消す" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "やり直す" })).toBeDisabled();
  });
});
