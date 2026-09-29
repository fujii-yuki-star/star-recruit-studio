// @vitest-environment jsdom
// 繰り返し再生（#1267）＝区間の終わりまで来たら始まりへ戻り、再生は続く。切っていれば終わりで止まる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTimelinePlayback } from "./useTimelinePlayback";
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
let queue: FrameRequestCallback[] = [];
const frame = () => act(() => { const q = queue; queue = []; for (const cb of q) cb(now); });

beforeEach(() => {
  now = 0; queue = [];
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  useTimelineStore.setState({ doc, isPlaying: false, playheadSec: 0, rangeInSec: null, rangeOutSec: null, loopPlayback: false, exportRun: { phase: "idle", percent: 0, message: null, cancelling: false } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("繰り返し再生（#1267）", () => {
  it("作業範囲の終わりまで来たら始まりへ戻り、再生を続ける", () => {
    useTimelineStore.setState({ loopPlayback: true, rangeInSec: 1, rangeOutSec: 3, playheadSec: 2 });
    renderHook(() => useTimelinePlayback());
    act(() => useTimelineStore.getState().play());
    const nonce = useTimelineStore.getState().seekNonce;
    now = 1500; // 2 → 3.5秒（区間の終わり 3秒を越える）
    frame();
    const s = useTimelineStore.getState();
    expect(s.playheadSec).toBe(1);
    expect(s.isPlaying, "繰り返さずに止まった").toBe(true);
    expect(s.seekNonce, "時計を測り直していない").toBeGreaterThan(nonce);
  });

  it("作業範囲の外から再生すると、区間の始まりから始める", () => {
    useTimelineStore.setState({ loopPlayback: true, rangeInSec: 4, rangeOutSec: 6, playheadSec: 0 });
    act(() => useTimelineStore.getState().play());
    expect(useTimelineStore.getState().playheadSec).toBe(4);
  });

  it("作業範囲が無ければ全体を繰り返す（終わりで先頭へ）", () => {
    useTimelineStore.setState({ loopPlayback: true, playheadSec: 9 });
    renderHook(() => useTimelinePlayback());
    act(() => useTimelineStore.getState().play());
    now = 2000; // 9 → 11秒（尺 10秒の終わりを越える）
    frame();
    expect(useTimelineStore.getState().playheadSec).toBe(0);
    expect(useTimelineStore.getState().isPlaying).toBe(true);
  });

  it("切っているときは、終わりで止まる（従来どおり）", () => {
    useTimelineStore.setState({ loopPlayback: false, playheadSec: 9 });
    renderHook(() => useTimelinePlayback());
    act(() => useTimelineStore.getState().play());
    now = 2000;
    frame();
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });
});
