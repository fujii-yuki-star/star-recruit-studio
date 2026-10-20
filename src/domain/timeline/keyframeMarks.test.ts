// 選んだ部品の帯に出すキーフレームの印（#1186 ②）。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { clipKeyframeTimes } from './keyframeMarks';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';

function doc(animations: TimelineProject['animations']): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20261021_001',
    projectName: 't',
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 2, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: 'あ' } as TimelineClip],
    groups: [{ id: 'group_001', members: ['clip_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
    animations,
  } as TimelineProject;
}

describe('clipKeyframeTimes', () => {
  it('自身のキーの時刻を昇順に・帯の長さの外は出さない・重なりは1つ', () => {
    const d = doc([
      { id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 2.5, x: 10 }, { timeSec: 0, x: 0 }, { timeSec: 3, opacity: 1 }, { timeSec: 4, x: 5 }] },
    ]);
    expect(clipKeyframeTimes(d, 'clip_001')).toEqual([0, 2.5, 3]);
  });
  it('まとまりの動きは出さない・動きが無い／部品が無いときは空', () => {
    expect(clipKeyframeTimes(doc([{ id: 'anim_001', targetId: 'group_001', keyframes: [{ timeSec: 1, x: 1 }] }]), 'clip_001')).toEqual([]);
    expect(clipKeyframeTimes(doc([]), 'clip_001')).toEqual([]);
    expect(clipKeyframeTimes(doc([]), 'clip_999')).toEqual([]);
  });
});
