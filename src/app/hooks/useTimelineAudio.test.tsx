// @vitest-environment jsdom
// タイムラインの音（#630）のうち、**音量の効かせ方**を固定する（#724）。
//
// 100%超（schema は 1.5 まで）は要素の `.volume`（0〜1）では上がらないので、場面形式と同じ
// 共有経路（`attachVolume`＝GainNode）を通す。ここが割れると**再生では 100% 止まりなのに
// 書き出しだけ 150% で出る**＝聞いて確かめられない（ADR-0026③・`11 §7.6.2.2`）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTimelineAudio } from "./useTimelineAudio";
import { useTimelineStore } from "../store/timelineStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const originalAC = (window as any).AudioContext;
const originalAudio = window.Audio;

function mockAudioContext() {
  const gain = { gain: { value: -1 }, connect: vi.fn((d: unknown) => d), disconnect: vi.fn() };
  const source = { connect: vi.fn(() => gain), disconnect: vi.fn() };
  const ctx = {
    createMediaElementSource: vi.fn(() => source),
    createGain: vi.fn(() => gain),
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
  return { ctx, gain };
}

/** 鳴らした要素を覚えておく偽 `Audio`（jsdom は再生できない）。 */
function stubAudio(): HTMLAudioElement[] {
  const made: HTMLAudioElement[] = [];
  (window as any).Audio = function (this: any) {
    const el = {
      volume: 1, muted: false, currentTime: 0, playbackRate: 1, loop: false,
      play: vi.fn(() => Promise.resolve()), pause: vi.fn(),
    } as unknown as HTMLAudioElement;
    made.push(el);
    return el;
  } as unknown as typeof Audio;
  return made;
}

function doc(volume: number): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: "proj_1", projectName: "t",
    createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets: [{ assetId: "asset_001", assetType: "bgm", displayName: "曲", filePath: "assets/asset_001.mp3" }],
    tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
    clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 5, assetId: "asset_001", volume }],
  };
}

const play = (volume: number) => {
  useTimelineStore.setState({
    doc: doc(volume), isPlaying: true, playheadSec: 1,
    audioSrcByKey: { "asset:asset_001": "blob:x" },
  });
};

beforeEach(() => {
  useTimelineStore.setState({ doc: null, isPlaying: false, playheadSec: 0, audioSrcByKey: {} });
});
afterEach(() => {
  (window as any).AudioContext = originalAC;
  (window as any).webkitAudioContext = undefined;
  window.Audio = originalAudio;
  vi.restoreAllMocks();
});

describe("useTimelineAudio の音量（#724）", () => {
  it("100%超は増幅して鳴らす（書き出しと同じだけ上がる）", () => {
    const { ctx, gain } = mockAudioContext();
    (window as any).AudioContext = function () { return ctx; };
    stubAudio();
    play(1.5);
    renderHook(() => useTimelineAudio());
    // 要素の `.volume` は 0〜1 なので、そこへ 1.5 を入れても上がらない＝GainNode 側に乗る。
    expect(gain.gain.value).toBeCloseTo(1.5, 5);
  });

  it("100%以下は今までどおり要素の音量で鳴らす（常道の経路を変えない）", () => {
    const { ctx } = mockAudioContext();
    (window as any).AudioContext = function () { return ctx; };
    const made = stubAudio();
    play(0.5);
    renderHook(() => useTimelineAudio());
    expect(made[0].volume).toBeCloseTo(0.5, 5);
    expect(ctx.createGain).not.toHaveBeenCalled(); // 100%以下で音声資源を掴まない
  });

  it("増幅できない環境では下げ方向だけ効かせる（黙って落とさない）", () => {
    (window as any).AudioContext = undefined;
    (window as any).webkitAudioContext = undefined;
    const made = stubAudio();
    play(1.5);
    renderHook(() => useTimelineAudio());
    expect(made[0].volume).toBe(1); // 上げられないぶんは据え置き（0 にはしない）
  });

  it("画面を離れたら音量の経路も畳む（音声資源を掴んだままにしない）", () => {
    const { ctx } = mockAudioContext();
    (window as any).AudioContext = function () { return ctx; };
    stubAudio();
    play(1.5);
    const { unmount } = renderHook(() => useTimelineAudio());
    unmount();
    expect(ctx.close).toHaveBeenCalled();
  });
});
