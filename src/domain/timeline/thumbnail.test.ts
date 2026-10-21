// タイムライン形式の一覧の小さな絵（2026-10-20 実機）＝何を描くか。
import { describe, expect, it } from 'vitest';
import { ASSET_TYPE, NARRATION_STATUS, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { thumbnailSourcePath, timelineThumbnailTime } from './thumbnail';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';

const box = { x: 0, y: 0, w: 100, h: 100 };
function doc(clips: TimelineClip[], hiddenTrack = false): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20261021_001',
    projectName: 't',
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [
      { assetId: 'asset_001', assetType: ASSET_TYPE.image, displayName: '写真', filePath: 'assets/asset_001.png' },
      { assetId: 'asset_002', assetType: ASSET_TYPE.video, displayName: '動画', filePath: 'assets/asset_002.mp4', thumbnailPath: 'assets/asset_002_thumb.png' },
      { assetId: 'asset_003', assetType: ASSET_TYPE.video, displayName: '絵の無い動画', filePath: 'assets/asset_003.mp4' },
      { assetId: 'asset_004', assetType: ASSET_TYPE.bgm, displayName: '音', filePath: 'assets/asset_004.mp3' },
    ],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual, ...(hiddenTrack ? { hidden: true } : {}) },
      { id: 'track_002', kind: TRACK_KIND.visual },
      { id: 'track_003', kind: TRACK_KIND.audio },
    ],
    clips,
  } as TimelineProject;
}
const text = (id: string, trackId: string, startSec: number): TimelineClip =>
  ({ id, kind: TIMELINE_CLIP_KIND.text, trackId, startSec, durationSec: 2, ...box, text: 'あ' }) as TimelineClip;
const voice = (id: string, startSec: number): TimelineClip =>
  ({ id, kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_003', startSec, durationSec: 2, voice: { text: 'あ', status: NARRATION_STATUS.none } }) as TimelineClip;

describe('timelineThumbnailTime', () => {
  it('いちばん早く絵が出る時刻（0 秒で切らない・音の部品は数えない）', () => {
    expect(timelineThumbnailTime(doc([voice('clip_001', 0), text('clip_002', 'track_002', 3), text('clip_003', 'track_001', 5)]))).toBe(3);
  });
  it('隠した列の部品は数えない', () => {
    expect(timelineThumbnailTime(doc([text('clip_001', 'track_001', 1), text('clip_002', 'track_002', 4)], true))).toBe(4);
  });
  it('絵の部品が無ければ null（絵を作らない）', () => {
    expect(timelineThumbnailTime(doc([voice('clip_001', 0)]))).toBeNull();
    expect(timelineThumbnailTime(doc([text('clip_001', 'track_001', 1)], true))).toBeNull();
  });
});

describe('thumbnailSourcePath', () => {
  it('写真は本体・動画は取り込み時の小さな絵・それ以外と見つからない素材は null', () => {
    const d = doc([]);
    expect(thumbnailSourcePath(d, 'asset_001')).toBe('assets/asset_001.png');
    expect(thumbnailSourcePath(d, 'asset_002')).toBe('assets/asset_002_thumb.png');
    expect(thumbnailSourcePath(d, 'asset_003')).toBeNull();
    expect(thumbnailSourcePath(d, 'asset_004')).toBeNull();
    expect(thumbnailSourcePath(d, 'asset_999')).toBeNull();
  });
});
