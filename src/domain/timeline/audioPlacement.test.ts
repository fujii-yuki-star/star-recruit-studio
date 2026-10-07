// 音の置き先（2026-09-28 の実機レビュー）。
//
// ⚠️ **映像と同じ規則にする**（ADR-0026②）＝以前は音だけ再生位置をそのまま使っていたので、
// そこが塞がっていると**断られた**。実機で確かめた＝同じ「置く」を押して、
// **映像は置けて、音は「ずらすか、列を足して重ねてください」**。
import { describe, expect, it } from "vitest";
import { audioPlacementAt, visualPlacementAt } from "./edit";
import { TRACK_KIND, TIMELINE_CLIP_KIND } from "../enums";
import type { TimelineProject } from "./types";

const doc = (over: Partial<TimelineProject> = {}): TimelineProject => ({
  schemaVersion: "2.0", format: "timeline", projectId: "p", projectName: "n",
  createdAt: "", updatedAt: "",
  videoSettings: { aspectRatio: "16:9" }, voiceSettings: {},
  assets: [],
  tracks: [{ id: "a1", kind: TRACK_KIND.audio }, { id: "v1", kind: TRACK_KIND.visual }],
  clips: [],
  ...over,
} as unknown as TimelineProject);

const audioClip = (id: string, startSec: number, durationSec: number) => ({
  id, kind: TIMELINE_CLIP_KIND.audio, trackId: "a1", startSec, durationSec, x: 0, y: 0, w: 0, h: 0,
});

describe("音の置き先（audioPlacementAt）", () => {
  it("空いていれば、その時刻に置く", () => {
    expect(audioPlacementAt(doc(), "a1", 3, 5)).toEqual({ trackId: "a1", startSec: 3 });
  });

  // ⚠️ **これが直したかったこと**＝以前はここで断られていた。
  it("塞がっていれば、次の空き時刻へずれる（断らない）", () => {
    const d = doc({ clips: [audioClip("c1", 0, 10)] as never });
    expect(audioPlacementAt(d, "a1", 3, 5)).toEqual({ trackId: "a1", startSec: 10 });
  });

  it("間の空きを飛び越さない（映像と同じ）", () => {
    const d = doc({ clips: [audioClip("c1", 0, 2), audioClip("c2", 20, 5)] as never });
    expect(audioPlacementAt(d, "a1", 0, 5)).toEqual({ trackId: "a1", startSec: 2 });
  });

  it("置ける音の列が無ければ `null`（押した側が理由を出す）", () => {
    const d = doc({ tracks: [{ id: "v1", kind: TRACK_KIND.visual }] as never });
    expect(audioPlacementAt(d, "a1", 0, 5)).toBeNull();
  });

  it("選んだ列が置けないときは、置ける列へ落とす（映像と同じ）", () => {
    const d = doc({ tracks: [{ id: "a1", kind: TRACK_KIND.audio }, { id: "v1", kind: TRACK_KIND.visual }] as never });
    expect(audioPlacementAt(d, "nope", 0, 5)?.trackId).toBe("a1");
  });

  // ⚠️ **映像と揃っていること自体**を見る（片方だけ直しても気づけるように）。
  it("同じ状況で、映像と音が同じ答えを出す", () => {
    const d = doc({
      clips: [
        audioClip("c1", 0, 6),
        { id: "c2", kind: TIMELINE_CLIP_KIND.text, trackId: "v1", startSec: 0, durationSec: 6, x: 0, y: 0, w: 1, h: 1 },
      ] as never,
    });
    const v = visualPlacementAt(d, "v1", 0);
    const a = audioPlacementAt(d, "a1", 0, v!.durationSec);
    expect(a!.startSec, "塞がったときのずれ方が種類で違う").toBe(v!.startSec);
  });
});
