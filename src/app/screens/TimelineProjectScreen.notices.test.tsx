// @vitest-environment jsdom
// 操作のあとの知らせ（#1385）と開いたときの知らせ（ADR-0057）が**画面に出る**こと。
// ⚠️ store に値が入るだけでは利用者に届かない＝以前は `editNotice` をどの画面も描いておらず、store の検査だけ緑だった（#1386 レビュー 🔴）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(async () => undefined),
}));
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { EXPORT_RUN_PHASE } from "../../domain/export/exportProgress";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";
import { reorientNotice, silenceAppliedMessage } from "../uiLabels";

const doc = (): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: "proj_20261008_001", projectName: "テスト",
  createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z",
  videoSettings: { aspectRatio: "9:16", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
} as unknown as TimelineProject);

const open = (over: Record<string, unknown>) => {
  useProjectStore.setState({ templates: [] });
  useTimelineStore.setState({
    doc: doc(), loadError: null, isLoading: false, playheadSec: 0, isPlaying: false,
    selectedClipIds: [], assetSrcById: {}, videoSrcById: {}, editBlocked: null, importError: null,
    history: { past: [], future: [] }, editNotice: null, openNotice: null, ...over,
  } as never);
  render(<TimelineProjectScreen onNavigate={vi.fn()} />);
};

beforeEach(() => {
  localStorage.clear();
  useTimelineStore.setState({ exportRun: { ...useTimelineStore.getState().exportRun, phase: EXPORT_RUN_PHASE.idle } } as never);
});

describe("知らせが画面に出る", () => {
  it("操作のあとの知らせ（無音を詰めた）が出る", () => {
    const text = silenceAppliedMessage(2, 3.5);
    open({ editNotice: text });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("開いたときの知らせは、部品を選んでも残り、「閉じる」で消える", () => {
    const text = reorientNotice(1, 0, 2);
    open({ openNotice: text });
    expect(screen.getByText(text)).toBeInTheDocument();
    act(() => useTimelineStore.getState().selectClip("clip_001"));
    expect(screen.getByText(text)).toBeInTheDocument();
    fireEvent.click(screen.getByText(text).parentElement!.querySelector("button")!);
    expect(screen.queryByText(text)).toBeNull();
  });
});
