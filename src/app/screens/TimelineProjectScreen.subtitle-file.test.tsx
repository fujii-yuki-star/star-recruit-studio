// @vitest-environment jsdom
// 「字幕ファイルを読み込む」（ADR-0055・#1351）＝選んだファイルの字幕が新しい列に並ぶ。
// 「字幕ファイルを書き出す」（決定4）＝文書の字幕が書き込みの口へ渡る（画面の配線を本物の store で通す）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(async () => undefined),
}));
vi.mock("../../infrastructure/dialog", async (orig) => ({
  ...(await orig<typeof import("../../infrastructure/dialog")>()),
  showSaveSubtitleDialog: vi.fn(async () => "C:/out/字幕.vtt"),
}));
import { invoke } from "@tauri-apps/api/core";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { EXPORT_RUN_PHASE } from "../../domain/export/exportProgress";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";
import { SUBTITLE_FILE_EXPORT_LABEL, SUBTITLE_FILE_IMPORT_LABEL, subtitleExportedMessage, subtitleFileMessage } from "../uiLabels";

const doc = (): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20261006_001",
  projectName: "テスト",
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  clips: [],
} as unknown as TimelineProject);

const open = () => {
  useProjectStore.setState({ templates: [] });
  useTimelineStore.setState({
    doc: doc(), loadError: null, isLoading: false, playheadSec: 0, isPlaying: false,
    selectedClipIds: [], assetSrcById: {}, videoSrcById: {}, editBlocked: null, importError: null,
    history: { past: [], future: [] },
  } as never);
  render(<TimelineProjectScreen onNavigate={vi.fn()} />);
};

beforeEach(() => {
  localStorage.clear();
  useTimelineStore.setState({ exportRun: { ...useTimelineStore.getState().exportRun, phase: EXPORT_RUN_PHASE.idle } } as never);
});

describe("字幕ファイルを読み込む（ADR-0055）", () => {
  it("選んだファイルの字幕が、時刻どおり新しい列に並ぶ", async () => {
    open();
    expect(screen.getByRole("button", { name: SUBTITLE_FILE_IMPORT_LABEL })).not.toBeDisabled();
    const file = new File(["WEBVTT\n\n00:01.000 --> 00:02.000\nこんにちは\n"], "a.vtt", { type: "text/vtt" });
    fireEvent.change(screen.getByTestId("subtitle-file-input"), { target: { files: [file] } });
    await waitFor(() => expect(useTimelineStore.getState().doc!.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.subtitle)).toHaveLength(1));
    const c = useTimelineStore.getState().doc!.clips[0];
    expect([c.startSec, c.durationSec, c.text]).toEqual([1, 1, "こんにちは"]);
  });

  it("書き出し中は押せず、理由が出る", () => {
    useTimelineStore.setState({ exportRun: { ...useTimelineStore.getState().exportRun, phase: EXPORT_RUN_PHASE.rendering } } as never);
    open();
    const btn = screen.getByRole("button", { name: SUBTITLE_FILE_IMPORT_LABEL });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title") ?? "").not.toBe("");
  });
});

describe("字幕ファイルを書き出す（ADR-0055 決定4）", () => {
  it("読み込んだ字幕を、選んだ形式でそのまま書き出す（往復）・書けた数を知らせる", async () => {
    open();
    const file = new File(["WEBVTT\n\n00:01.000 --> 00:02.000\nこんにちは\n"], "a.vtt", { type: "text/vtt" });
    fireEvent.change(screen.getByTestId("subtitle-file-input"), { target: { files: [file] } });
    await waitFor(() => expect(useTimelineStore.getState().doc!.clips).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: SUBTITLE_FILE_EXPORT_LABEL }));
    expect(await screen.findByText(subtitleExportedMessage(1))).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("write_subtitle_file", {
      path: "C:/out/字幕.vtt",
      text: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nこんにちは\n",
    });
  });

  it("字幕が無ければ書かずに次の行動を言う", async () => {
    vi.mocked(invoke).mockClear();
    open();
    fireEvent.click(screen.getByRole("button", { name: SUBTITLE_FILE_EXPORT_LABEL }));
    expect(await screen.findByText(subtitleFileMessage.SUBTITLE_FILE_NOTHING_TO_EXPORT)).toBeInTheDocument();
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "write_subtitle_file")).toBe(false);
  });
});
