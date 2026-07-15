// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { lineAudioKey } from "../../domain/project/narrationLines";
import type { Scene } from "../../domain/project/types";
import { PreviewScreen } from "./PreviewScreen";

// 同時開始（ADR-0031）：開始秒が同じ行（startWithPrevious）はプレビューでも前を止めず重ねて再生する。
const simulScene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" },
    lines: [
      { lineId: "line_001", text: "A", status: "none" },
      { lineId: "line_002", text: "B", startWithPrevious: true, status: "none" }, // line_001 と同時
    ],
    warnings: [],
  }) as unknown as Scene;

describe("PreviewScreen 同時開始の並行再生（ADR-0031）", () => {
  const playedEls: HTMLMediaElement[] = [];
  beforeEach(() => {
    playedEls.length = 0;
    // play は解決＝scheduleNext が進む（窓0の同時グループで2本目まで到達）。再生した要素（this）を記録。
    vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      playedEls.push(this);
      return Promise.resolve();
    });
    vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    const meta0 = useProjectStore.getState().meta;
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [simulScene()],
      narrationAudioById: {
        [lineAudioKey("scene_001", "line_001")]: "blob:a",
        [lineAudioKey("scene_001", "line_002")]: "blob:b",
      },
      // BGM を切って再生される音声をナレーションのみに絞る（BGM の play を数えない）。
      meta: { ...meta0, bgmSettings: undefined },
      saveStatus: "saved",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("同時グループの2行とも play() が走る＝並行再生（並行対応前は先頭行が 0 秒窓で落ち1本＝新旧を判別）", async () => {
    render(<PreviewScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "再生" }));
    // BGM 無し＝再生はナレーションのみ。同時グループは両行が場面窓 [0,尺] を共有＝2本とも play() が走る。
    // 「止めず重ねて流す」挙動と音量/ミュートの全員反映は domain（lineSegments/sceneSegmentSpecs/compileTimeline）と
    // この2本 play() で担保する（ライブ音量/ミュートは narrationGroupCtlsRef.forEach＝再生 effect の各声へ適用）。
    await waitFor(() => expect(playedEls).toHaveLength(2));
  });
});
