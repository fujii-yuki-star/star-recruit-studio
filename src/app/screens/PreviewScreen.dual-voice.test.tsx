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
  // play/pause を発生順に記録する（イベント列）＋**どの音源か**も記録する。
  // 回数だけを見ると、行の音声でない音（BGM）を2本目と数えて**空振りで緑**になる（#620）。
  const events: ("play" | "pause")[] = [];
  const srcs: string[] = [];
  /** 行の音声だけ（`narrationAudioById` に入れた blob: の2つ）。 */
  const lineSrcs = () => srcs.filter((s) => s.startsWith("blob:"));
  beforeEach(() => {
    events.length = 0;
    srcs.length = 0;
    // play は解決＝scheduleNext が進む（窓0の同時グループで2本目まで到達）。
    vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      events.push("play");
      srcs.push(this.src);
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
      // `bgmSettings: undefined` でも**既定の標準BGMは鳴る**（#620 で実測）。BGM を数に入れないのは
      // 上の `lineSrcs()`（音源で選り分け）が担う。
      meta: { ...meta0, bgmSettings: undefined },
      status: "ready", // 自動生成（autoGenerateIfSafe）を発火させない＝この場面が差し替えられない（#620）
      saveStatus: "saved",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("同時グループの2行は前を止めず連続で play()＝並行（逐次退行なら2本目の前に pause が入る）", async () => {
    render(<PreviewScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "再生" }));
    // **2行それぞれ**が鳴る（並行対応前は先頭行が 0 秒窓で落ち1本）。回数でなく音源で見る＝BGM を2本目と数えない。
    await waitFor(() => expect(lineSrcs()).toEqual(["blob:a", "blob:b"]));
    // ★2本目が鳴り始めるまでに pause が1つも無い＝前の声を止めていない（並行）。
    // 逐次に退行して「2本目の開始前に1本目を pause」すると、ここに pause が現れて落ちる。
    expect(events.indexOf("pause")).toBe(-1);
  });
});
