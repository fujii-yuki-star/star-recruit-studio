// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #410 sub3 レビュー：場面編集→仕上がり確認→「場面編集へ戻る」で“いま編集中の場面”に戻れること。
// 戻るときに先頭場面へ落ちない（editingSceneId に編集中の場面を預けてから遷移する）ことを固定する。
function scene(id: string, order: number, narration: string): Scene {
  return {
    sceneId: id,
    partId: "part_001",
    order,
    sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1",
    durationSec: 8,
    assetRefs: {},
    character: { enabled: false, characterId: "yuko" },
    texts: {},
    narration: { text: narration, status: "none" },
    warnings: [],
  };
}

describe("SceneEditScreen 仕上がり確認への往復（#410 sub3 レビュー：編集中の場面を保持）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002", "scene_003"] }],
      scenes: [scene("scene_001", 1, "FIRST"), scene("scene_002", 2, "SECOND"), scene("scene_003", 3, "THIRD")],
      assets: [],
      editingSceneId: "scene_003", // 3場面目を編集中で開く
      previewReturnTo: null,
      past: [],
      future: [],
      _historyGroupDepth: 0,
      saveStatus: "saved",
    });
  });

  it("「仕上がり確認へ」で編集中の場面を editingSceneId に預け、戻ると同じ場面が選ばれる（先頭に落ちない）", () => {
    const onNavigate = vi.fn();
    const first = render(<SceneEditScreen onNavigate={onNavigate} />);
    // 3場面目で開いている（narration が THIRD）。
    expect(first.getByDisplayValue("THIRD")).toBeTruthy();

    // 仕上がり確認へ。編集中の場面（3場面目）を預け、戻り先＝場面編集を記録して遷移する。
    fireEvent.click(first.getByRole("button", { name: /仕上がり確認へ/ }));
    expect(onNavigate).toHaveBeenCalledWith("preview");
    expect(useProjectStore.getState().previewReturnTo).toBe("scene-edit");
    expect(useProjectStore.getState().editingSceneId).toBe("scene_003");

    // 「場面編集へ戻る」＝SceneEdit 再マウント。editingSceneId を読んで3場面目（THIRD）を選ぶ（先頭 FIRST ではない）。
    first.unmount();
    const second = render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(second.getByDisplayValue("THIRD")).toBeTruthy();
    expect(second.queryByDisplayValue("FIRST")).toBeNull();
  });
});
