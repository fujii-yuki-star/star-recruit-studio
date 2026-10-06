// 字幕ファイルの字幕を並べる（ADR-0055 決定3・#1351）。
import { describe, expect, it } from "vitest";
import { TIMELINE_MIN_CLIP_SEC, VIDEO_HARD_MAX_SEC } from "../constants";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../enums";
import { importSubtitleCues } from "./edit";
import { parseTimelineProjectDoc } from "./persistence";
import { subtitleTextOf } from "./subtitleLink";
import { TIMELINE_SCHEMA_VERSION } from "./types";
import type { TimelineProject } from "./types";

const doc = (): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20261006_001",
  projectName: "t",
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 10, x: 0, y: 0, w: 100, h: 50, text: "既存" }],
} as unknown as TimelineProject);

describe("importSubtitleCues", () => {
  it("キューごとに字幕クリップ（自分の文・連動なし）を新しい列へ・既存の部品は触らない", () => {
    const r = importSubtitleCues(doc(), [{ startSec: 1, endSec: 2.5, text: "こんにちは" }, { startSec: 3, endSec: 4, text: "二つ目" }]);
    expect(r.placed).toBe(2);
    const added = r.doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.subtitle);
    expect(added.map((c) => [c.startSec, c.durationSec, subtitleTextOf(r.doc, c)])).toEqual([[1, 1.5, "こんにちは"], [3, 1, "二つ目"]]);
    expect(new Set(added.map((c) => c.trackId)).size).toBe(1);
    expect(added[0].trackId).not.toBe("track_001");
    expect(added[0].voiceClipId).toBeUndefined();
    expect(r.doc.clips.find((c) => c.id === "clip_001")).toEqual(doc().clips[0]);
  });

  it("重なるキューは列を足して並べ、絵も上へ積む（同じ場所に重ねない）", () => {
    const r = importSubtitleCues(doc(), [{ startSec: 1, endSec: 3, text: "A" }, { startSec: 2, endSec: 4, text: "B" }]);
    const [a, b] = r.doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.subtitle);
    expect(a.trackId).not.toBe(b.trackId);
    expect(b.y).toBeLessThan(a.y!);
  });

  it("短すぎるキューは最小まで伸ばす・上限を越えるキューは置かず数を返す", () => {
    const r = importSubtitleCues(doc(), [
      { startSec: 1, endSec: 1.001, text: "短い" },
      { startSec: VIDEO_HARD_MAX_SEC - 1, endSec: VIDEO_HARD_MAX_SEC + 1, text: "はみ出す" },
    ]);
    expect(r.placed).toBe(1);
    expect(r.beyondLimit).toBe(1);
    expect(r.doc.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.subtitle)!.durationSec).toBe(TIMELINE_MIN_CLIP_SEC);
  });

  it("置けるものが無ければ文書を変えない", () => {
    const d = doc();
    const r = importSubtitleCues(d, [{ startSec: VIDEO_HARD_MAX_SEC, endSec: VIDEO_HARD_MAX_SEC + 2, text: "x" }]);
    expect(r).toEqual({ doc: d, placed: 0, beyondLimit: 1 });
  });

  it("並べた文書は保存して開き直せる（schema に通る）", () => {
    const r = importSubtitleCues(doc(), [{ startSec: 1, endSec: 2, text: "保存できる" }]);
    expect(() => parseTimelineProjectDoc(JSON.stringify(r.doc))).not.toThrow();
  });
});
