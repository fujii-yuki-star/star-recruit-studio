// 字幕から読み上げを作る（ADR-0055 追補 2026-10-20・#1485）と、声の長さが当たるときに空いた列へ移す（`fitVoiceLength`）。
import { describe, expect, it } from "vitest";
import { NARRATION_STATUS, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../enums";
import { fitVoiceLength, voicesFromSubtitles } from "./edit";
import { subtitleTextOf } from "./subtitleLink";
import { TIMELINE_SCHEMA_VERSION } from "./types";
import type { TimelineClip, TimelineProject, Track } from "./types";

const box = { x: 0, y: 900, w: 1920, h: 120 };
const sub = (id: string, startSec: number, durationSec: number, text: string | undefined, over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id, kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_002", startSec, durationSec, ...box, ...(text != null ? { text } : {}), ...over }) as TimelineClip;
const voice = (id: string, startSec: number, durationSec: number, trackId = "track_003"): TimelineClip =>
  ({ id, kind: TIMELINE_CLIP_KIND.voice, trackId, startSec, durationSec, voice: { text: "声", status: NARRATION_STATUS.none } }) as TimelineClip;

function doc(clips: TimelineClip[], tracks: Track[] = [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }]): TimelineProject {
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
    tracks,
    clips,
  };
}
const byId = (d: TimelineProject, id: string): TimelineClip => d.clips.find((c) => c.id === id)!;
const trackKind = (d: TimelineProject, id: string) => d.tracks.find((t) => t.id === id)?.kind;

describe("voicesFromSubtitles", () => {
  it("字幕と同じ時刻・長さの読み上げを新しい音の列へ置き、字幕を連動させる（声は動画全体の声）", () => {
    const d = doc([sub("clip_001", 1, 2, "こんにちは"), sub("clip_002", 3, 1.5, "二つ目")]);
    const r = voicesFromSubtitles(d, ["clip_001", "clip_002"]);
    expect(r.voiceIds).toHaveLength(2);
    expect(r.skipped).toBe(0);
    const voices = r.voiceIds.map((id) => byId(r.doc, id));
    expect(voices.map((v) => [v.kind, v.startSec, v.durationSec, v.voice?.text, v.voice?.status, v.voice?.speaker])).toEqual([
      [TIMELINE_CLIP_KIND.voice, 1, 2, "こんにちは", NARRATION_STATUS.none, undefined],
      [TIMELINE_CLIP_KIND.voice, 3, 1.5, "二つ目", NARRATION_STATUS.none, undefined],
    ]);
    // 新しい音の列（既存の列ではない）・重ならないので1つの列にそろう
    expect(new Set(voices.map((v) => v.trackId)).size).toBe(1);
    expect(trackKind(r.doc, voices[0].trackId)).toBe(TRACK_KIND.audio);
    expect(d.tracks.map((t) => t.id)).not.toContain(voices[0].trackId);
    // 字幕は連動し、文は読み上げに追従（同じ文なので自分の文は外す）＝出る文は変わらない
    expect(byId(r.doc, "clip_001").voiceClipId).toBe(r.voiceIds[0]);
    expect(byId(r.doc, "clip_001").text).toBeUndefined();
    expect(subtitleTextOf(r.doc, byId(r.doc, "clip_001"))).toBe("こんにちは");
  });

  it("重なる字幕は音の列を足して置く（同じ列で重ねない）", () => {
    const d = doc([sub("clip_001", 1, 3, "A"), sub("clip_002", 2, 3, "B", { trackId: "track_001" })]);
    const r = voicesFromSubtitles(d, ["clip_001", "clip_002"]);
    const [a, b] = r.voiceIds.map((id) => byId(r.doc, id));
    expect(a.trackId).not.toBe(b.trackId);
    expect([trackKind(r.doc, a.trackId), trackKind(r.doc, b.trackId)]).toEqual([TRACK_KIND.audio, TRACK_KIND.audio]);
  });

  it("改行を含む字幕は、読み上げの文から改行を除き、字幕は自分の文として残す（見た目の改行を消さない）", () => {
    const d = doc([sub("clip_001", 0, 2, "一行目\n二行目")]);
    const r = voicesFromSubtitles(d, ["clip_001"]);
    expect(byId(r.doc, r.voiceIds[0]).voice?.text).toBe("一行目二行目");
    expect(byId(r.doc, "clip_001").text).toBe("一行目\n二行目");
    expect(byId(r.doc, "clip_001").voiceClipId).toBe(r.voiceIds[0]);
  });

  it("連動済み・文が無い・固定した列の字幕は作らず数える／字幕でない部品は数えない", () => {
    const d = doc(
      [
        sub("clip_001", 0, 1, "連動済み", { voiceClipId: "clip_009" }),
        sub("clip_002", 1, 1, "  "),
        sub("clip_003", 2, 1, "固定", { trackId: "track_001" }),
        { id: "clip_004", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 5, durationSec: 1, ...box, text: "文字" } as TimelineClip,
        sub("clip_005", 3, 1, "作る"),
      ],
      [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.visual }],
    );
    const r = voicesFromSubtitles(d, ["clip_001", "clip_002", "clip_003", "clip_004", "clip_005"]);
    expect(r.voiceIds).toHaveLength(1);
    expect(byId(r.doc, r.voiceIds[0]).voice?.text).toBe("作る");
    expect(r.skipped).toBe(3);
  });

  it("作れる字幕が無ければ文書を変えない", () => {
    const d = doc([sub("clip_001", 0, 1, "")]);
    const r = voicesFromSubtitles(d, ["clip_001"]);
    expect(r.doc).toBe(d);
    expect(r.voiceIds).toEqual([]);
  });
});

describe("fitVoiceLength", () => {
  const audio = (id: string, over: Partial<Track> = {}): Track => ({ id, kind: TRACK_KIND.audio, ...over });

  it("今の場所で合わせられるなら列は変えない（連動した字幕も一緒に伸びる）", () => {
    const d = doc([sub("clip_001", 0, 2, undefined, { voiceClipId: "clip_002" }), voice("clip_002", 0, 2)],
      [{ id: "track_002", kind: TRACK_KIND.visual }, audio("track_003")]);
    const r = fitVoiceLength(d, "clip_002", 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([byId(r.doc, "clip_002").trackId, byId(r.doc, "clip_002").durationSec]).toEqual(["track_003", 3]);
    expect([byId(r.doc, "clip_001").trackId, byId(r.doc, "clip_001").durationSec]).toEqual(["track_002", 3]);
    expect(r.doc.tracks).toHaveLength(2);
  });

  it("次の字幕・次の読み上げとぶつかるなら、空いた列（無ければ足す）へ移してから合わせる", () => {
    const d = doc(
      [
        sub("clip_001", 0, 2, undefined, { voiceClipId: "clip_002" }), voice("clip_002", 0, 2),
        sub("clip_003", 2, 2, undefined, { voiceClipId: "clip_004" }), voice("clip_004", 2, 2),
      ],
      [{ id: "track_002", kind: TRACK_KIND.visual }, audio("track_003")],
    );
    const r = fitVoiceLength(d, "clip_002", 2.5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = byId(r.doc, "clip_002");
    const s = byId(r.doc, "clip_001");
    expect(v.durationSec).toBe(2.5);
    expect(s.durationSec).toBe(2.5);
    expect(v.trackId).not.toBe("track_003");
    expect(s.trackId).not.toBe("track_002");
    expect(trackKind(r.doc, v.trackId)).toBe(TRACK_KIND.audio);
    expect(trackKind(r.doc, s.trackId)).toBe(TRACK_KIND.visual);
    // ほかの部品は動かない
    expect(byId(r.doc, "clip_004")).toEqual(byId(d, "clip_004"));
    expect(byId(r.doc, "clip_003")).toEqual(byId(d, "clip_003"));
  });

  it("移す先は読み上げだけの列（音量を変えていない）を先に使い、BGM の列・音量を変えた列には入れない", () => {
    const bgm = { id: "clip_010", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_004", startSec: 10, durationSec: 5, bundledBgmId: "bgm_01" } as unknown as TimelineClip;
    const d = doc(
      [
        voice("clip_002", 0, 2), voice("clip_004", 2, 2),
        bgm, voice("clip_005", 10, 1, "track_005"), voice("clip_006", 10, 1, "track_006"),
      ],
      [audio("track_003"), audio("track_004"), audio("track_005", { volume: 0.5 }), audio("track_006")],
    );
    const r = fitVoiceLength(d, "clip_002", 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(byId(r.doc, "clip_002").trackId).toBe("track_006");
    expect(r.doc.tracks).toHaveLength(4);
  });

  it("列が固定されていれば移さず、合わせられない理由をそのまま返す", () => {
    const d = doc([voice("clip_002", 0, 2), voice("clip_004", 2, 2)], [audio("track_003", { locked: true })]);
    const r = fitVoiceLength(d, "clip_002", 3);
    expect(r.ok).toBe(false);
  });
});
