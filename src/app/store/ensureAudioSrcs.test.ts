// 取り込んで置いた直後から鳴る（#1061）。開いたときにまとめて読むだけでは足りない。
//
// ⚠️ 同じ形は動画で一度直している（#512 段1＝「開き直すと映るのに、取り込んだ直後は映らない」）。
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../infrastructure/assetFs", async (orig) => ({
  ...(await orig<typeof import("../../infrastructure/assetFs")>()),
  readAssetDataUrl: vi.fn(async () => "data:audio/mp3;base64,NEW"),
}));
vi.mock("../../infrastructure/projectFs", () => ({
  saveProjectDoc: vi.fn(async () => {}),
  listProjectSummaries: vi.fn(async () => []),
  setLastProjectId: vi.fn(), getLastProjectId: vi.fn(() => null), clearLastProjectId: vi.fn(),
  deleteProjectDoc: vi.fn(), loadProjectDoc: vi.fn(async () => ""),
}));

import { readAssetDataUrl } from "../../infrastructure/assetFs";
import { useTimelineStore } from "./timelineStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineClip, TimelineProject } from "../../domain/timeline/types";

const doc = (clips: TimelineClip[]): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20260907_001",
  projectName: "テスト",
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [{ assetId: "asset_001", assetType: "bgm", displayName: "曲", filePath: "assets/asset_001.mp3" }],
  tracks: [{ id: "track_001", kind: TRACK_KIND.audio }],
  clips,
}) as TimelineProject;

const audioClip = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_001", startSec: 0, durationSec: 5,
     assetId: "asset_001", ...over }) as TimelineClip;

beforeEach(() => {
  vi.clearAllMocks();
  useTimelineStore.setState({ doc: doc([audioClip()]), audioSrcByKey: {}, _audioTried: new Set() } as never);
});

describe("ensureAudioSrcs（#1061）", () => {
  it("まだ用意していない音源を読む（置いた直後から鳴る）", async () => {
    await useTimelineStore.getState().ensureAudioSrcs();
    expect(useTimelineStore.getState().audioSrcByKey["asset:asset_001"]).toBe("data:audio/mp3;base64,NEW");
  });

  // ⚠️ **もうあるものは読み直さない**＝選び直しの読み直し（#1050）を上書きしない。
  it("もう用意してある音源は読まない", async () => {
    useTimelineStore.setState({ audioSrcByKey: { "asset:asset_001": "data:audio/mp3;base64,OLD" } } as never);
    await useTimelineStore.getState().ensureAudioSrcs();
    expect(vi.mocked(readAssetDataUrl), "もうあるのに読み直した").not.toHaveBeenCalled();
    expect(useTimelineStore.getState().audioSrcByKey["asset:asset_001"]).toBe("data:audio/mp3;base64,OLD");
  });

  // ⚠️ **読めなかったものは二度とたのまない**（`11 §7.6.2.2`）＝毎回の描き直しで読みに行かない。
  it("読めなかった音源は、もう一度たのまない", async () => {
    vi.mocked(readAssetDataUrl).mockResolvedValue(null);
    await useTimelineStore.getState().ensureAudioSrcs();
    await useTimelineStore.getState().ensureAudioSrcs();
    expect(vi.mocked(readAssetDataUrl).mock.calls.length, "何度もたのんだ").toBe(1);
  });

  // ⚠️ **待っている間に別の動画を開いたら、そちらへは書かない**（取り込みと同じ判定位置）。
  it("待っている間に別の動画を開いたら、そちらへは書かない", async () => {
    const holder: { release?: (v: string | null) => void } = {};
    vi.mocked(readAssetDataUrl).mockImplementation(() => new Promise((r) => { holder.release = r; }));
    const run = useTimelineStore.getState().ensureAudioSrcs();
    useTimelineStore.setState({ doc: { ...doc([]), projectId: "proj_20260907_002" } } as never);
    holder.release?.("data:audio/mp3;base64,NEW");
    await run;
    expect(useTimelineStore.getState().audioSrcByKey["asset:asset_001"], "別の動画へ書いた").toBeUndefined();
  });
});
