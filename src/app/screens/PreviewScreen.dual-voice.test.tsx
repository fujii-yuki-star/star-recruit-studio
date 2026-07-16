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
  // play/pause を発生順に記録する（イベント列）。BGM は切ってナレーションのみに絞る。
  const events: ("play" | "pause")[] = [];
  beforeEach(() => {
    events.length = 0;
    // play は解決＝scheduleNext が進む（窓0の同時グループで2本目まで到達）。
    vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(() => {
      events.push("play");
      return Promise.resolve();
    });
    vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {
      events.push("pause");
    });
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
      meta: { ...meta0, bgmSettings: undefined }, // BGM を切る＝pause は narration 由来のみ
      saveStatus: "saved",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("同時グループの2行は前を止めず連続で play()＝並行（逐次退行なら2本目の前に pause が入る）", async () => {
    render(<PreviewScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "再生" }));
    // 両行とも再生される（並行対応前は先頭行が 0 秒窓で落ち1本）。
    await waitFor(() => expect(events.filter((e) => e === "play")).toHaveLength(2));
    // ★最初の2イベントが play,play＝間に pause が無い＝前の声を止めていない（並行）。
    // 逐次に退行して「2本目の開始前に1本目を pause」すると play,pause,play になり、この assert が落ちる。
    expect(events.slice(0, 2)).toEqual(["play", "play"]);
  });
});
