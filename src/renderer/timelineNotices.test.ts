// タイムライン形式の「書き出しは止めないが知らせたい」注意（#1366）。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../domain/timeline/types';
import type { TimelineClip, TimelineProject } from '../domain/timeline/types';
import { timelineTruncatedTexts } from './timelineNotices';

const doc = (clips: TimelineClip[], over: Partial<TimelineProject> = {}): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: 'proj_20261007_001',
  projectName: 't',
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [],
  tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual, hidden: true }],
  clips,
  ...over,
} as TimelineProject);
const text = (id: string, w: number, h: number, body: string, track = 'track_001'): TimelineClip =>
  ({ id, kind: TIMELINE_CLIP_KIND.text, trackId: track, startSec: 0, durationSec: 4, x: 0, y: 0, w, h, text: body, fontSize: 100 }) as TimelineClip;

describe('timelineTruncatedTexts（#1366）', () => {
  it('枠に入りきらず「…」になる文字だけを挙げる（入る文字・字幕でない図形は挙げない）', () => {
    const d = doc([
      text('clip_001', 400, 110, '漫才「キーフレームズ」'), // 1行・4文字ぶんの幅＝切れる
      text('clip_002', 1800, 110, '漫才「キーフレームズ」'), // 入る
    ]);
    expect(timelineTruncatedTexts(d, () => undefined)).toEqual(['漫才「キーフレームズ」']);
  });

  it('描かれない部品は数えない（隠した列）', () => {
    const d = doc([text('clip_001', 400, 110, '隠れている長い文字', 'track_002')]);
    expect(timelineTruncatedTexts(d, () => undefined)).toEqual([]);
  });

  it('連動した字幕は、連動先の読み上げ文で見る', () => {
    const d = doc([
      { id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_003', startSec: 0, durationSec: 4, voice: { text: 'とても長い読み上げの文がここに入ります', status: 'none' } } as TimelineClip,
      { id: 'clip_002', kind: TIMELINE_CLIP_KIND.subtitle, trackId: 'track_001', startSec: 0, durationSec: 4, x: 0, y: 0, w: 400, h: 60, fontSize: 48, voiceClipId: 'clip_001' } as TimelineClip,
    ], { tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_003', kind: TRACK_KIND.audio }] } as Partial<TimelineProject>);
    expect(timelineTruncatedTexts(d, () => undefined)).toEqual(['とても長い読み上げの文がここに入ります']);
  });
});
