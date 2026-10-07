// @vitest-environment jsdom
// 「止めて、ここで切り替え」（#1365）＝キーフレームの「ここまでの動き方」で選ぶと、そのキーの動き方が「止める」になる。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { EASING, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
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
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 10, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
  animations: [{ id: "anim_001", targetId: "clip_001", keyframes: [{ timeSec: 0, rotation: 360 }, { timeSec: 8, rotation: 0 }] }],
} as unknown as TimelineProject);

beforeEach(() => localStorage.clear());

describe("止めて、ここで切り替え（#1365）", () => {
  it("選ぶと、そのキーの動き方が「止める」になり、カーブでは表せないことをその場で言う", () => {
    useProjectStore.setState({ templates: [] });
    useTimelineStore.setState({
      doc: doc(), loadError: null, isLoading: false, playheadSec: 1, isPlaying: false,
      selectedClipIds: ["clip_001"], assetSrcById: {}, videoSrcById: {}, editBlocked: null,
      history: { past: [], future: [] }, _historyGroupDepth: 0,
    } as never);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const selects = screen.getAllByRole("combobox", { name: "ここまでの動き方" });
    const last = selects[selects.length - 1];
    expect(screen.getAllByRole("option", { name: "止めて、ここで切り替え" }).length).toBeGreaterThan(0);
    fireEvent.change(last, { target: { value: EASING.hold } });
    const kfs = useTimelineStore.getState().doc!.animations![0].keyframes;
    expect(kfs.find((k) => k.timeSec === 8)?.easing).toBe(EASING.hold);
    expect(screen.getByText(/「自由なカーブ」にすると/)).toBeInTheDocument();
  });
});
