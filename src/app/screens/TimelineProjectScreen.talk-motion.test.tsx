// @vitest-environment jsdom
// 喋っている間の動き（ADR-0056・#1367）＝映像の部品の欄で、どの声で動くか・動き方・強さを選ぶ。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { PROJECT_FORMAT, TALK_MOTION_KIND, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";

const doc = (): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20261007_001",
  projectName: "テスト",
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio, name: "みずいろの声" }],
  clips: [
    { id: "clip_001", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 0, durationSec: 10, x: 0, y: 0, w: 100, h: 100, shapeType: "rect" },
    { id: "clip_002", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 1, durationSec: 2, voice: { text: "あ", status: "none" } },
  ],
} as unknown as TimelineProject);

beforeEach(() => localStorage.clear());

describe("喋っている間の動き（ADR-0056）", () => {
  it("声の列を名前で選ぶと付き（既定ははねる）、動き方を変えられ、「動かない」で外れる", () => {
    useProjectStore.setState({ templates: [] });
    useTimelineStore.setState({
      doc: doc(), loadError: null, isLoading: false, playheadSec: 0, isPlaying: false,
      selectedClipIds: ["clip_001"], assetSrcById: {}, videoSrcById: {}, editBlocked: null,
      history: { past: [], future: [] }, _historyGroupDepth: 0,
    } as never);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const tm = () => useTimelineStore.getState().doc!.clips[0].talkMotion;
    const which = screen.getByRole("combobox", { name: "どの声で動くか" });
    expect(screen.getByRole("option", { name: "みずいろの声" })).toBeInTheDocument();
    fireEvent.change(which, { target: { value: "track_002" } });
    expect(tm()).toEqual({ trackId: "track_002", kind: TALK_MOTION_KIND.bounce });
    fireEvent.change(screen.getByRole("combobox", { name: "動き方" }), { target: { value: TALK_MOTION_KIND.bob } });
    expect(tm()?.kind).toBe(TALK_MOTION_KIND.bob);
    fireEvent.change(screen.getByRole("combobox", { name: "どの声で動くか" }), { target: { value: "" } });
    expect(tm()).toBeUndefined();
  });
});
