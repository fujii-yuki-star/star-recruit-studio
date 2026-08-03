import { describe, expect, it } from 'vitest';

import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { audioCuesAt, volumeAt, volumeExpr } from './audio';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';

const POINTS = [
  { timeSec: 0, volume: 0.2 },
  { timeSec: 4, volume: 1 },
];

const doc = (over: Partial<TimelineClip> = {}): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: 'proj_20260803_001',
  projectName: 'テスト',
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/a.mp3' }],
  tracks: [{ id: 'track_001', kind: TRACK_KIND.audio }],
  clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_001', startSec: 0, durationSec: 8, assetId: 'asset_001', ...over }],
});

describe('volumeAt（音量の変化・#512）', () => {
  it('点が無ければ undefined（クリップ一定の音量へ落ちる）', () => {
    expect(volumeAt(undefined, 1)).toBeUndefined();
    expect(volumeAt([], 1)).toBeUndefined();
  });

  it('点の間は線形に変わる', () => {
    expect(volumeAt(POINTS, 0)).toBeCloseTo(0.2, 9);
    expect(volumeAt(POINTS, 2)).toBeCloseTo(0.6, 9);
    expect(volumeAt(POINTS, 4)).toBeCloseTo(1, 9);
  });

  it('点の外は端の値で伸ばす（黙って 0 や 1 に化けない）', () => {
    expect(volumeAt(POINTS, -5)).toBeCloseTo(0.2, 9);
    expect(volumeAt(POINTS, 99)).toBeCloseTo(1, 9);
  });

  it('順序が崩れていても結果は同じ（保存の並びに依存しない）', () => {
    expect(volumeAt([...POINTS].reverse(), 2)).toBeCloseTo(volumeAt(POINTS, 2)!, 9);
  });

  it('同じ時刻に2つあっても有限の値を返す（0 で割らない）', () => {
    const v = volumeAt([{ timeSec: 1, volume: 0.1 }, { timeSec: 1, volume: 0.9 }], 1);
    expect(Number.isFinite(v!)).toBe(true);
  });

  it('範囲外の音量は保存できる範囲へ収める（schema と同じ 0〜1.5）', () => {
    expect(volumeAt([{ timeSec: 0, volume: 9 }], 0)).toBeLessThanOrEqual(1.5);
    expect(volumeAt([{ timeSec: 0, volume: -1 }], 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('再生への効き方（#512）', () => {
  it('その時刻の音量で鳴る（クリップ一定の値ではなく点列から採る）', () => {
    const d = doc({ volumePoints: POINTS, volume: 0.05 });
    expect(validateTimelineProject(d)).toBe(true);
    expect(audioCuesAt(d, 2)[0].volume).toBeCloseTo(0.6, 6);
    expect(audioCuesAt(d, 0)[0].volume).toBeCloseTo(0.2, 6);
  });

  it('フェードはその上に掛かる（「基準×フェード係数」の形は変えない）', () => {
    const d = doc({ volumePoints: [{ timeSec: 0, volume: 1 }, { timeSec: 8, volume: 1 }], fadeInSec: 2 });
    // 1秒地点＝フェードイン半ば＝基準1×0.5。
    expect(audioCuesAt(d, 1)[0].volume).toBeCloseTo(0.5, 6);
  });

  it('点が無ければ従来どおりクリップ一定の音量', () => {
    expect(audioCuesAt(doc({ volume: 0.3 }), 2)[0].volume).toBeCloseTo(0.3, 6);
  });
});

describe('volumeExpr（書き出しの式・#512 段3）', () => {
  it('点が無ければ undefined（従来どおり一定値の音量で出す）', () => {
    expect(volumeExpr(undefined)).toBeUndefined();
    expect(volumeExpr([])).toBeUndefined();
  });

  it('点列から線形の式を組む（先頭・末尾は端の値で伸ばす＝volumeAt と同じ規則）', () => {
    expect(volumeExpr(POINTS)).toBe('if(lt(t,0),0.2,if(lt(t,4),0.2+(1-0.2)*(t-0)/4,1))');
  });

  it('同じ時刻が2つ並んでも 0 で割らない', () => {
    const e = volumeExpr([{ timeSec: 1, volume: 0.1 }, { timeSec: 1, volume: 0.9 }]);
    expect(e).not.toContain('/0');
  });

  it('並びが崩れていても同じ式になる（保存の並びに依存しない）', () => {
    expect(volumeExpr([...POINTS].reverse())).toBe(volumeExpr(POINTS));
  });
});
