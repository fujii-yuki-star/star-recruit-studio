// 帯に描く音量の線（#1266）＝鳴らす側と同じ関数（`clipGainAt`）で拾う。
import { describe, expect, it } from 'vitest';
import { audioCuesAt, clipGainAt, clipVolumeEnvelope } from './audio';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';

const base = { id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_001', startSec: 2, durationSec: 10, bundledBgmId: 'bgm_bright_01' } as unknown as TimelineClip;
function doc(clip: TimelineClip): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: 'proj_20260929_001', projectName: 't',
    createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' }, assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.audio }], clips: [clip],
  } as TimelineProject;
}

describe('clipVolumeEnvelope（#1266）', () => {
  it('フェードの両端は無音、中は一定', () => {
    const c = { ...base, volume: 1, fadeInSec: 2, fadeOutSec: 3 } as TimelineClip;
    const env = clipVolumeEnvelope(c, doc(c));
    expect(env[0]).toEqual({ t: 0, gain: 0 });
    expect(env[env.length - 1]).toEqual({ t: 10, gain: 0 });
    expect(env.find((p) => p.t === 2)?.gain, 'フェードの境で拾っていない').toBe(1);
    expect(env.find((p) => p.t === 7)?.gain, 'フェード出の境で拾っていない').toBe(1);
  });

  it('音量の変化の点で拾う', () => {
    const c = { ...base, volumePoints: [{ timeSec: 0, volume: 1 }, { timeSec: 4, volume: 0.2 }] } as TimelineClip;
    const env = clipVolumeEnvelope(c, doc(c));
    expect(env.find((p) => p.t === 4)?.gain).toBeCloseTo(0.2, 5);
  });

  // ⚠️ **鳴らす側と同じ値**＝線と聞こえ方がずれない。
  it('どの点も、鳴らす側（audioCuesAt）の音量と同じ', () => {
    const c = { ...base, volume: 0.8, fadeInSec: 1.5, fadeOutSec: 2, volumePoints: [{ timeSec: 3, volume: 1.2 }, { timeSec: 8, volume: 0.4 }] } as TimelineClip;
    const d = doc(c);
    for (const p of clipVolumeEnvelope(c, d)) {
      if (p.t >= c.durationSec) continue; // 区間は半開（終わりちょうどは鳴っていない）
      const cue = audioCuesAt(d, c.startSec + p.t)[0];
      expect(p.gain, `${p.t}秒`).toBeCloseTo(cue.volume, 9);
      expect(p.gain).toBe(clipGainAt(c, d, p.t));
    }
  });

  it('時刻の順に並び、重ならない・長さ 0 は空', () => {
    const c = { ...base, fadeInSec: 2 } as TimelineClip;
    const ts = clipVolumeEnvelope(c, doc(c)).map((p) => p.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(new Set(ts).size).toBe(ts.length);
    expect(clipVolumeEnvelope({ ...base, durationSec: 0 } as TimelineClip, doc(base))).toEqual([]);
  });
});
