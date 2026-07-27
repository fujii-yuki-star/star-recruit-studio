// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { lineAudioKey } from "../../domain/project/narrationLines";
import type { Scene } from "../../domain/project/types";
import { PreviewScreen } from "./PreviewScreen";

// #392 レビュー：掛け合い（scene.lines）の行音声も、停止・場面送り・行切替で play() が中断された
// AbortError では偽の「声を再生できませんでした」警告を出さない（単一ナレーション/BGM と同挙動）。
const dialogueScene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" },
    lines: [{ lineId: "line_001", text: "こんにちは", startSec: 0 }],
    warnings: [],
  } as unknown as Scene);

describe("PreviewScreen 掛け合い行音声の AbortError 黙殺（#392 レビュー）", () => {
  let playSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // すべての HTMLMediaElement.play を AbortError で reject（停止/中断の再現）。
    playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(
      () => Promise.reject(new DOMException("interrupted", "AbortError")),
    );
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [dialogueScene()],
      narrationAudioById: { [lineAudioKey("scene_001", "line_001")]: "blob:fake" },
      status: "ready", // 自動生成（autoGenerateIfSafe）を発火させない＝この場面が差し替えられない（#620）
      saveStatus: "saved",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("行音声の play() が AbortError で中断されても偽の失敗警告を出さない", async () => {
    render(<PreviewScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "再生" }));
    await waitFor(() => expect(playSpy).toHaveBeenCalled()); // 行音声の play() が実際に走った
    // AbortError は正常系＝ナレーション失敗の警告バナーは出ない。
    expect(screen.queryByText(/声を再生できませんでした/)).toBeNull();
  });
});
