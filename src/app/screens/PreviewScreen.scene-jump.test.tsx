// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { PreviewScreen } from "./PreviewScreen";

// #413：仕上がり確認に場面ジャンプ。20場面で「次の場面」を連打しなくても、番号を押せばその場面へ跳べる。
const scene = (id: string, order: number): Scene =>
  ({
    sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  }) as unknown as Scene;

describe("PreviewScreen 場面ジャンプ（#413）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002", "scene_003"] }],
      scenes: [scene("scene_001", 1), scene("scene_002", 2), scene("scene_003", 3)],
      saveStatus: "saved",
    });
  });

  it("番号ボタンで直接その場面へ跳べ、今の場面が aria-current になる", () => {
    render(<PreviewScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("場面 1 / 3")).toBeTruthy(); // 初期は先頭
    expect(screen.getByRole("button", { name: "場面1へ移動" }).getAttribute("aria-current")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "場面3へ移動" })); // 3場面目へ跳ぶ
    expect(screen.getByText("場面 3 / 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "場面3へ移動" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "場面1へ移動" }).getAttribute("aria-current")).toBeNull();
  });
});
