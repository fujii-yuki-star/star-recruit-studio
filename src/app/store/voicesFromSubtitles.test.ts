import { beforeEach, describe, expect, it, vi } from "vitest";

// 選んだ字幕から読み上げを作る（ADR-0055 追補 2026-10-20・#1485）＝置く・連動させるは1回の編集、続けて置いた読み上げだけの声を作る。
// 合成とディスクI/Oはモック（`timelineBulkVoice.test.ts` と同じ流儀）。
vi.mock("../../infrastructure/voiceFs", () => ({
  importVoiceFile: vi.fn(async (_projectId: string, stem: string) => `voices/${stem}.wav`),
  readVoiceDataUrl: vi.fn(async () => null),
}));
vi.mock("../../infrastructure/projectFs", () => ({
  saveProjectDoc: vi.fn(async () => {}),
  listProjectSummaries: vi.fn(async () => []),
  setLastProjectId: vi.fn(),
  getLastProjectId: vi.fn(() => null),
  clearLastProjectId: vi.fn(),
  deleteProjectDoc: vi.fn(),
  loadProjectDoc: vi.fn(async () => ""),
}));

import { voicesFromSubtitlesMessage } from "../uiLabels";
import { useTimelineStore } from "./timelineStore";
import { MockVoiceProvider } from "../../infrastructure/voiceProviders/mockVoiceProvider";
import { NARRATION_STATUS, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineClip, TimelineProject } from "../../domain/timeline/types";

const box = { x: 0, y: 900, w: 1920, h: 120 };
const sub = (id: string, startSec: number, durationSec: number, text: string): TimelineClip =>
  ({ id, kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec, durationSec, ...box, text }) as TimelineClip;

function doc(clips: TimelineClip[]): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: "proj_20261020_001",
    projectName: "テスト",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets: [],
    tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
    clips,
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function setDoc(d: TimelineProject, selected: string[]): void {
  useTimelineStore.setState({
    doc: d,
    selectedClipIds: selected,
    history: { past: [], future: [] },
    _historyGroupDepth: 0,
    isGeneratingVoices: false,
    voicesCancelled: false,
    _bulkVoiceRun: 0,
    _voiceRun: null,
    generatingVoiceClipId: null,
    voiceError: null,
    editNotice: null,
    exportRun: { phase: "idle", percent: 0, message: null, cancelling: false },
    audioSrcByKey: {},
    _audioTried: new Set<string>(),
  } as never);
}

const clipsOf = (kind: string) => useTimelineStore.getState().doc!.clips.filter((c) => c.kind === kind);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("makeVoicesFromSelectedSubtitles", () => {
  it("置いて連動させ、置いた読み上げの声を作る・声の長さが当たれば空いた列へ移して字幕も声に合わせる", async () => {
    const synth = vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockResolvedValue({ audioDataUrl: "wav", durationSec: 2.5 });
    setDoc(doc([sub("clip_001", 0, 2, "一つ目"), sub("clip_002", 2, 2, "二つ目")]), ["clip_001", "clip_002"]);
    useTimelineStore.getState().makeVoicesFromSelectedSubtitles();
    expect(useTimelineStore.getState().editNotice).toBe(voicesFromSubtitlesMessage(2, 0, false));
    await flush();
    expect(synth).toHaveBeenCalledTimes(2);
    const voices = clipsOf(TIMELINE_CLIP_KIND.voice);
    expect(voices.map((v) => [v.voice?.status, v.durationSec])).toEqual([
      [NARRATION_STATUS.generated, 2.5],
      [NARRATION_STATUS.generated, 2.5],
    ]);
    // 1つ目は2つ目とぶつかるので列が分かれる（合わせられなかった、にならない）
    expect(voices[0].trackId).not.toBe(voices[1].trackId);
    expect(useTimelineStore.getState().voiceError).toBeNull();
    const subs = clipsOf(TIMELINE_CLIP_KIND.subtitle);
    expect(subs.map((s) => s.durationSec)).toEqual([2.5, 2.5]);
    expect(subs.map((s) => s.voiceClipId)).toEqual(voices.map((v) => v.id));
  });

  it("置く・連動させるは取り消し1回で戻る", () => {
    vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockReturnValue(new Promise(() => {}));
    const d = doc([sub("clip_001", 0, 2, "一つ目")]);
    setDoc(d, ["clip_001"]);
    useTimelineStore.getState().makeVoicesFromSelectedSubtitles();
    expect(clipsOf(TIMELINE_CLIP_KIND.voice)).toHaveLength(1);
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc!.clips).toEqual(d.clips);
  });

  // ⚠️ **手で置いた読み上げは作らない・移さない**＝置いた読み上げだけに絞る。
  it("ほかのまだ作っていない読み上げは作らない", async () => {
    const synth = vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockResolvedValue({ audioDataUrl: "wav", durationSec: 1 });
    const other = { id: "clip_009", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 10, durationSec: 2,
      voice: { text: "手で置いた", status: NARRATION_STATUS.none } } as TimelineClip;
    const d = { ...doc([sub("clip_001", 0, 2, "一つ目"), other]), tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }] };
    setDoc(d as TimelineProject, ["clip_001"]);
    useTimelineStore.getState().makeVoicesFromSelectedSubtitles();
    await flush();
    expect(synth).toHaveBeenCalledTimes(1);
    expect(useTimelineStore.getState().doc!.clips.find((c) => c.id === "clip_009")?.voice?.status).toBe(NARRATION_STATUS.none);
  });

  it("まとめて作っている最中は置くだけで、後で作るよう言う", async () => {
    const synth = vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockResolvedValue({ audioDataUrl: "wav", durationSec: 1 });
    setDoc(doc([sub("clip_001", 0, 2, "一つ目")]), ["clip_001"]);
    useTimelineStore.setState({ isGeneratingVoices: true });
    useTimelineStore.getState().makeVoicesFromSelectedSubtitles();
    await flush();
    expect(clipsOf(TIMELINE_CLIP_KIND.voice)).toHaveLength(1);
    expect(synth).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().editNotice).toBe(voicesFromSubtitlesMessage(1, 0, true));
  });

  it("作れる字幕が無ければ文書を変えず、選び方を言う", () => {
    const d = doc([sub("clip_001", 0, 2, "")]);
    setDoc(d, ["clip_001"]);
    useTimelineStore.getState().makeVoicesFromSelectedSubtitles();
    expect(useTimelineStore.getState().doc).toBe(d);
    expect(useTimelineStore.getState().editNotice).toBe(voicesFromSubtitlesMessage(0, 1, false));
  });
});
