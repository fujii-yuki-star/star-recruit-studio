// @vitest-environment jsdom
// 本体の時計を外から1歩進める（ADR-0050）＝本体の窓が隠れて描く合図が止まっても、別窓の合図で再生が進む。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTimelinePlayback } from "./useTimelinePlayback";
import { pulsePlayback, setPlaybackPulse } from "./playbackPulse";
import { useTimelineStore } from "../store/timelineStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";

const doc: TimelineProject = {
  schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: "proj_20260929_001", projectName: "t",
  createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" }, assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 10, x: 0, y: 0, w: 1, h: 1, text: "あ" }],
};

let now = 0;
beforeEach(() => {
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  // 描く合図は**来ない**（本体の窓が隠れている）。
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  useTimelineStore.setState({ doc, isPlaying: false, playheadSec: 0, rangeInSec: null, rangeOutSec: null, loopPlayback: false, exportRun: { phase: "idle", percent: 0, message: null, cancelling: false } });
});
afterEach(() => { setPlaybackPulse(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("本体の時計を外から1歩進める（ADR-0050）", () => {
  it("描く合図が来なくても、外からの合図で始めた実時刻どおりに進む（余計に呼んでもずれない）", () => {
    renderHook(() => useTimelinePlayback());
    act(() => useTimelineStore.getState().play());
    now = 1000;
    act(() => pulsePlayback());
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1, 5);
    act(() => pulsePlayback());
    act(() => pulsePlayback());
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1, 5);
    now = 2500;
    act(() => pulsePlayback());
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(2.5, 5);
  });

  it("終わりまで来たら止め、その後の合図では何もしない", () => {
    useTimelineStore.setState({ playheadSec: 9 });
    renderHook(() => useTimelinePlayback());
    act(() => useTimelineStore.getState().play());
    now = 2000;
    act(() => pulsePlayback());
    expect(useTimelineStore.getState().isPlaying).toBe(false);
    const at = useTimelineStore.getState().playheadSec;
    now = 5000;
    act(() => pulsePlayback());
    expect(useTimelineStore.getState().playheadSec).toBe(at);
  });

  // ⚠️ 先頭へ戻した直後、測り直しが済む前に合図が重なっても、二重に戻さない（音の合わせ直しが2度走る）。
  it("繰り返しで先頭へ戻した直後の合図では、もう一度戻さない", () => {
    useTimelineStore.setState({ loopPlayback: true, playheadSec: 9 });
    renderHook(() => useTimelinePlayback());
    act(() => useTimelineStore.getState().play());
    const nonce = useTimelineStore.getState().seekNonce;
    now = 2000;
    act(() => { pulsePlayback(); pulsePlayback(); });
    expect(useTimelineStore.getState().seekNonce).toBe(nonce + 1);
  });

  it("止めたら合図を受けない", () => {
    renderHook(() => useTimelinePlayback());
    act(() => useTimelineStore.getState().play());
    act(() => useTimelineStore.getState().pause());
    now = 3000;
    act(() => pulsePlayback());
    expect(useTimelineStore.getState().playheadSec).toBe(0);
  });

  it("別窓（時計を持たない）では合図を預けない・再生しても進めない", () => {
    renderHook(() => useTimelinePlayback(false));
    act(() => useTimelineStore.getState().play());
    now = 1000;
    act(() => pulsePlayback());
    expect(useTimelineStore.getState().playheadSec).toBe(0);
  });

  it("別窓では、画面を離れても本体の再生を止めない", () => {
    const { unmount } = renderHook(() => useTimelinePlayback(false));
    act(() => useTimelineStore.getState().play());
    unmount();
    expect(useTimelineStore.getState().isPlaying).toBe(true);
  });
});
