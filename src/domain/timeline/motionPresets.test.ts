// タイムライン形式の動きのひな形（#1349）。
import { describe, expect, it } from "vitest";
import { EASING, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../enums";
import { POP_START_SCALE, SLIDE_DISTANCE } from "../project/animationPresets";
import { interpolateKeyframes } from "../project/keyframes";
import { EDIT_BLOCKED } from "./edit";
import {
  applyMotionPreset,
  EMPHASIS_BOUNCE_PX,
  EMPHASIS_SHAKE_PX,
  EMPHASIS_ZOOM_SCALE,
  MOTION_PRESET_MAX_SEC,
  motionPresetKeyframes,
} from "./motionPresets";
import { TIMELINE_SCHEMA_VERSION } from "./types";
import type { TimelineProject } from "./types";

const doc = (over: Partial<TimelineProject> = {}): TimelineProject => ({
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
  clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 2, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
  ...over,
} as TimelineProject);

describe("motionPresetKeyframes", () => {
  const clip = { durationSec: 4 };

  it("登場は帯の始まりから（場面形式と同じ動き）", () => {
    const k = motionPresetKeyframes({ place: "in", kind: "slide", direction: "left", durationSec: 0.6 }, clip);
    expect(k[0]).toEqual({ timeSec: 0, opacity: 0, x: -SLIDE_DISTANCE });
    expect(k[1]).toEqual(expect.objectContaining({ timeSec: 0.6, opacity: 1, x: 0 }));
  });

  it("退場は帯の終わりで終わり、登場の逆をたどる（終わりで「ずれ」の側へ抜ける）", () => {
    const k = motionPresetKeyframes({ place: "out", kind: "pop", durationSec: 0.5 }, clip);
    expect(k.map((x) => x.timeSec)).toEqual([3.5, 4]);
    expect(k[0]).toEqual(expect.objectContaining({ scale: 1, opacity: 1 }));
    expect(k[1]).toEqual(expect.objectContaining({ scale: POP_START_SCALE, opacity: 0, easing: EASING.easeInOut }));
    expect(k[0].easing).toBeUndefined(); // 最初の点の動き方は前の区間のもの＝付けない
  });

  it("強調は再生位置から・帯の外へ出るなら終わりで終わるよう前へずらす・始まりと終わりはずれ無し", () => {
    const z = motionPresetKeyframes({ place: "emphasis", kind: "zoom", durationSec: 1 }, clip, { atSec: 1 });
    expect(z.map((x) => x.timeSec)).toEqual([1, 1.4, 2]);
    expect(z.map((x) => x.scale)).toEqual([1, EMPHASIS_ZOOM_SCALE, 1]);
    const late = motionPresetKeyframes({ place: "emphasis", kind: "shake", durationSec: 1 }, clip, { atSec: 3.8 });
    expect(late[0].timeSec).toBe(3);
    expect(late.at(-1)!.timeSec).toBe(4);
    expect(late[0].x).toBe(0);
    expect(late.at(-1)!.x).toBe(0);
    expect(Math.max(...late.map((x) => Math.abs(x.x ?? 0)))).toBe(EMPHASIS_SHAKE_PX);
    const b = motionPresetKeyframes({ place: "emphasis", kind: "bounce", durationSec: 1 }, clip, { atSec: 0 });
    expect(Math.min(...b.map((x) => x.y ?? 0))).toBe(-EMPHASIS_BOUNCE_PX);
  });

  it("長さは 0.1〜5 秒、さらに帯の長さに収める（はみ出した点は効かない）", () => {
    expect(motionPresetKeyframes({ place: "in", kind: "fade", durationSec: 99 }, { durationSec: 10 }).at(-1)!.timeSec).toBe(MOTION_PRESET_MAX_SEC);
    expect(motionPresetKeyframes({ place: "in", kind: "fade", durationSec: 3 }, { durationSec: 1 }).at(-1)!.timeSec).toBe(1);
    expect(motionPresetKeyframes({ place: "out", kind: "fade", durationSec: 3 }, { durationSec: 1 })[0].timeSec).toBe(0);
  });
});

describe("applyMotionPreset", () => {
  it("キーフレームの列へ展開する（描画は既存の補間＝途中の値も出る）", () => {
    const r = applyMotionPreset(doc(), "clip_001", { place: "in", kind: "fade", durationSec: 1 });
    if (!r.ok) throw new Error("断られた");
    const kfs = r.doc.animations![0].keyframes;
    expect(kfs.map((k) => k.timeSec)).toEqual([0, 1]);
    expect(interpolateKeyframes(kfs, 0.5).opacity).toBeGreaterThan(0);
  });

  it("置き換えずに重ねる＝別の項目の動きは消さない", () => {
    const base = doc({ animations: [{ id: "anim_001", targetId: "clip_001", keyframes: [{ timeSec: 0, x: 100 }, { timeSec: 4, x: 300 }] }] });
    const r = applyMotionPreset(base, "clip_001", { place: "emphasis", kind: "zoom", durationSec: 1 }, { atSec: 1 });
    if (!r.ok) throw new Error("断られた");
    const kfs = r.doc.animations![0].keyframes;
    expect(kfs.filter((k) => k.x != null).map((k) => [k.timeSec, k.x])).toEqual([[0, 100], [4, 300]]);
    expect(kfs.filter((k) => k.scale != null)).toHaveLength(3);
  });

  it("固定した列・見つからない部品は断る（文書を変えない）", () => {
    const locked = doc({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
    expect(applyMotionPreset(locked, "clip_001", { place: "in", kind: "fade", durationSec: 1 })).toEqual({ ok: false, reason: EDIT_BLOCKED.locked });
    expect(applyMotionPreset(doc(), "clip_404", { place: "in", kind: "fade", durationSec: 1 })).toEqual({ ok: false, reason: EDIT_BLOCKED.notFound });
  });
});
