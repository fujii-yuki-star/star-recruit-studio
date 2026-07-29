// クレジットに出す話者の決め方（ADR-0003・ADR-0026②・#631）。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { creditSpeakerAt } from './credit';
import type { TimelineClip, TimelineProject } from './types';
import { TIMELINE_SCHEMA_VERSION } from './types';

function voiceClip(id: string, over: Partial<TimelineClip> = {}, speaker?: number): TimelineClip {
  return {
    id,
    kind: TIMELINE_CLIP_KIND.voice,
    trackId: 'track_002',
    startSec: 0,
    durationSec: 5,
    voice: { text: 'あ', status: 'generated', voicePath: `voices/${id}.wav`, speaker },
    ...over,
  };
}

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260729_001',
    projectName: 'テスト',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.audio },
    ],
    clips: [],
    ...over,
  };
}

describe('creditSpeakerAt', () => {
  it('しゃべっている声の話者を返す', () => {
    const d = doc({ clips: [voiceClip('clip_001', { startSec: 1, durationSec: 2 }, 3)] });
    expect(creditSpeakerAt(d, 1.5)).toBe(3);
  });

  it('誰もしゃべっていない時刻は null（呼ぶ側が既定の話者へ落とす）', () => {
    const d = doc({ clips: [voiceClip('clip_001', { startSec: 1, durationSec: 2 }, 3)] });
    expect(creditSpeakerAt(d, 0.5)).toBeNull();
    expect(creditSpeakerAt(d, 3)).toBeNull(); // 区間は半開＝終わりちょうどは含まない
  });

  it('話者を指定していない声は null（動画の既定を継承する＝実際に合成される声と揃う）', () => {
    const d = doc({ clips: [voiceClip('clip_001')] });
    expect(creditSpeakerAt(d, 1)).toBeNull();
  });

  it('同時に鳴っているときは先に始まったほう（時刻から一意に決まる）', () => {
    const d = doc({
      clips: [
        voiceClip('clip_002', { startSec: 1, durationSec: 5, trackId: 'track_002' }, 8),
        voiceClip('clip_001', { startSec: 0, durationSec: 5, trackId: 'track_003' }, 3),
      ],
      tracks: [
        { id: 'track_002', kind: TRACK_KIND.audio },
        { id: 'track_003', kind: TRACK_KIND.audio },
      ],
    });
    expect(creditSpeakerAt(d, 2)).toBe(3);
  });

  it('同時に始まったときは並び順によらず同じ結果（フレームごとに揺れない）', () => {
    const a = voiceClip('clip_001', { trackId: 'track_002' }, 3);
    const b = voiceClip('clip_002', { trackId: 'track_003' }, 8);
    const tracks = [
      { id: 'track_002', kind: TRACK_KIND.audio },
      { id: 'track_003', kind: TRACK_KIND.audio },
    ];
    expect(creditSpeakerAt(doc({ clips: [a, b], tracks }), 1)).toBe(3);
    expect(creditSpeakerAt(doc({ clips: [b, a], tracks }), 1)).toBe(3);
  });

  it('まだ作っていない読み上げは数えない（鳴らない声のキャラを名乗らない）', () => {
    const d = doc({
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 5,
          voice: { text: 'あ', status: 'none', speaker: 2 } },
      ],
    });
    expect(creditSpeakerAt(d, 1)).toBeNull();
  });

  it('鳴らない声（隠したクリップ・隠した列）は数えない（聞こえない声のキャラを出さない）', () => {
    const hiddenClip = doc({ clips: [voiceClip('clip_001', { hidden: true }, 3)] });
    expect(creditSpeakerAt(hiddenClip, 1)).toBeNull();
    const hiddenTrack = doc({
      clips: [voiceClip('clip_001', {}, 3)],
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio, hidden: true }],
    });
    expect(creditSpeakerAt(hiddenTrack, 1)).toBeNull();
  });
});
