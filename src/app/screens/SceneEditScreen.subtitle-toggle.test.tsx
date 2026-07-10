// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #413：単一ナレーションの場面でも場面ごとに字幕 ON/OFF できるよう、scene.subtitleEnabledDefault を書く
// 「この場面の字幕を表示する」トグルを追加。resolveLineSubtitle（line → scene → 既定true）に乗るだけで schema 不変。
const scene = (id: string): Scene =>
  ({
    sceneId: id, partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "こんにちは", status: "none" }, warnings: [],
  }) as unknown as Scene;

describe("SceneEditScreen 場面ごとの字幕トグル（#413）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene("scene_001")],
      assets: [],
      editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("単一ナレーションの場面で字幕を切ると scene.subtitleEnabledDefault=false（既定 true・再度で true）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const sw = screen.getByRole("switch", { name: "この場面の字幕を表示する" });
    expect(sw.getAttribute("aria-checked")).toBe("true"); // 既定は表示（未設定＝true）
    fireEvent.click(sw);
    expect(useProjectStore.getState().scenes[0].subtitleEnabledDefault).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: "この場面の字幕を表示する" }));
    expect(useProjectStore.getState().scenes[0].subtitleEnabledDefault).toBe(true);
  });
});
