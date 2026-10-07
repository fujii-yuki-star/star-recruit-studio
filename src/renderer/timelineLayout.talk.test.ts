// 喋っている間の動きは、キーフレームの結果の上に足す（ADR-0056 決定4・5）。描画の核（プレビュー＝書き出し）で見る。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../domain/enums';
import { TALK_BOUNCE_PX, TALK_BOUNCE_UP_SEC, TALK_PULSE_SCALE, TALK_WAVE_HZ } from '../domain/timeline/talkMotion';
import { TIMELINE_SCHEMA_VERSION } from '../domain/timeline/types';
import type { TalkMotion, TimelineClip, TimelineProject } from '../domain/timeline/types';
import { timelineCanvasClipsAt } from './timelineLayout';

const doc = (talkMotion: TalkMotion | undefined, keyframes = [{ timeSec: 0, y: 40, scale: 2 }]): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: 'proj_20261007_001',
  projectName: 't',
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [],
  tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
  clips: [
    { id: 'clip_001', kind: TIMELINE_CLIP_KIND.shape, trackId: 'track_001', startSec: 0, durationSec: 10, x: 0, y: 0, w: 100, h: 100, shapeType: 'rect', ...(talkMotion ? { talkMotion } : {}) },
    { id: 'clip_002', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 2, durationSec: 3, voice: { text: 'あ', status: 'none' } },
  ] as TimelineClip[],
  animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes }],
} as TimelineProject);
const tr = (d: TimelineProject, t: number) => timelineCanvasClipsAt(d, t)[0].ownTr;

describe('喋っている間の動きを描画の核で足す（ADR-0056）', () => {
  it('はねる＝キーフレームの縦のずれに足す（大きさは触らない）', () => {
    const t = 2 + TALK_BOUNCE_UP_SEC;
    expect(tr(doc({ trackId: 'track_002', kind: 'bounce' }), t)).toEqual(expect.objectContaining({ y: 40 - TALK_BOUNCE_PX, scale: 2 }));
    expect(tr(doc(undefined), t)).toEqual(expect.objectContaining({ y: 40, scale: 2 }));
  });

  it('ふくらむ＝キーフレームの大きさに掛ける', () => {
    const t = 2 + 1 / (4 * TALK_WAVE_HZ);
    expect(tr(doc({ trackId: 'track_002', kind: 'pulse' }), t).scale).toBeCloseTo(2 * (1 + TALK_PULSE_SCALE), 9);
  });

  it('キーフレームが無い部品にも効く', () => {
    const t = 2 + TALK_BOUNCE_UP_SEC;
    expect(tr(doc({ trackId: 'track_002', kind: 'bounce' }, []), t).y).toBeCloseTo(-TALK_BOUNCE_PX, 9);
  });
});
