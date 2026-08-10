// 帯を再生位置で分ける（#686 段階4・ADR-0034 決定16）。
import { describe, expect, it } from 'vitest';
import { splitClip, splitClipIssue, splitKeyframes, splitVolumePoints, SPLIT_BLOCKED } from './split';
import { volumeAt } from './audio';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { validateTimelineProject } from '../validation/generated/validators.js';
import type { TimelineClip, TimelineProject } from './types';

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260810_001',
    projectName: 'テスト',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips: [],
    ...over,
  };
}

const text = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 10, x: 0, y: 0, w: 100, h: 50, text: 'あ', ...over }) as TimelineClip;

const split = (d: TimelineProject, id: string, at: number) => splitClip(d, id, at, volumeAt);

describe('splitClipIssue（そこで分けられるか）', () => {
  it('帯の中なら分けられる', () => {
    expect(splitClipIssue(doc({ clips: [text()] }), 'clip_001', 4)).toBeNull();
  });

  it('**読み上げは切れない**（文と音がずれる）', () => {
    const d = doc({ clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 10, voice: { text: 'あ', status: 'none' } } as TimelineClip] });
    expect(splitClipIssue(d, 'clip_001', 4)).toBe(SPLIT_BLOCKED.unsplittable);
  });

  it('**連動している字幕も切れない**（時間は読み上げが決める）', () => {
    const d = doc({ clips: [text({ kind: TIMELINE_CLIP_KIND.subtitle, voiceClipId: 'clip_009' })] });
    expect(splitClipIssue(d, 'clip_001', 4)).toBe(SPLIT_BLOCKED.unsplittable);
  });

  it('固定した列では分けられない', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }], clips: [text()] });
    expect(splitClipIssue(d, 'clip_001', 4)).toBe(SPLIT_BLOCKED.locked);
  });

  it('帯の外・端では分けられない（片方が潰れる切り方をさせない）', () => {
    const d = doc({ clips: [text()] });
    expect(splitClipIssue(d, 'clip_001', 0)).toBe(SPLIT_BLOCKED.outside);
    expect(splitClipIssue(d, 'clip_001', 10)).toBe(SPLIT_BLOCKED.outside);
    expect(splitClipIssue(d, 'clip_001', 0.05)).toBe(SPLIT_BLOCKED.outside); // 最小の長さに満たない
    expect(splitClipIssue(d, 'clip_001', 20)).toBe(SPLIT_BLOCKED.outside);
  });
});

describe('splitClip（分ける）', () => {
  it('前半は**同じ id のまま**・後半が新しい id（選択や連動の参照が切れない）', () => {
    const r = split(doc({ clips: [text()] }), 'clip_001', 4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.clips[0]).toMatchObject({ id: 'clip_001', startSec: 0, durationSec: 4 });
    expect(r.doc.clips[1]).toMatchObject({ id: r.newClipId, startSec: 4, durationSec: 6 });
    expect(r.newClipId).not.toBe('clip_001');
  });

  it('合計の長さは変わらない（切っただけ）', () => {
    const r = split(doc({ clips: [text({ startSec: 2, durationSec: 9 })] }), 'clip_001', 5);
    expect(r.ok && r.doc.clips[0].durationSec + r.doc.clips[1].durationSec).toBeCloseTo(9, 6);
  });

  it('**素材のどこから使うか**を進める（速度ぶんも進む）', () => {
    const d = doc({
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio }],
      assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/a.mp3' }],
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 10, assetId: 'asset_001', sourceStartSec: 3, speed: 2 } as TimelineClip],
    });
    const r = split(d, 'clip_001', 4);
    expect(r.ok && r.doc.clips[0].sourceStartSec).toBe(3); // 前半はそのまま
    expect(r.ok && r.doc.clips[1].sourceStartSec).toBeCloseTo(3 + 4 * 2, 6); // 置いた長さ×速度ぶん進む
  });

  it('**フェードは前後に残す**（真ん中に切れ目の音を作らない）', () => {
    const d = doc({
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio }],
      assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/a.mp3' }],
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 10, assetId: 'asset_001', fadeInSec: 1, fadeOutSec: 2 } as TimelineClip],
    });
    const r = split(d, 'clip_001', 4);
    expect(r.ok && r.doc.clips[0]).toMatchObject({ fadeInSec: 1 });
    expect(r.ok && 'fadeOutSec' in r.doc.clips[0]).toBe(false); // 前半に抜けは付けない
    expect(r.ok && r.doc.clips[1]).toMatchObject({ fadeOutSec: 2 });
    expect(r.ok && 'fadeInSec' in r.doc.clips[1]).toBe(false); // 後半に入りは付けない
  });

  it('分けた結果はスキーマに適合する（開けない動画を作らない）', () => {
    const r = split(doc({ clips: [text()] }), 'clip_001', 4);
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('分けられないときは文書を変えない', () => {
    const d = doc({ clips: [text()] });
    const r = split(d, 'clip_001', 0);
    expect(r.ok).toBe(false);
    expect(d.clips).toHaveLength(1);
  });
});

describe('splitKeyframes（動きを分ける）', () => {
  const kf = [
    { timeSec: 0, x: 0 },
    { timeSec: 10, x: 100 },
  ];

  it('**分割点の値を両端に焼く**（切っただけで絵が飛ばない）', () => {
    const { head, tail } = splitKeyframes(kf, 4);
    expect(head[head.length - 1]).toMatchObject({ timeSec: 4, x: 40 }); // 前半の終わり＝そのときの値
    expect(tail[0]).toMatchObject({ timeSec: 0, x: 40 }); // 後半の始まり＝同じ値
  });

  it('後半の時刻は**自分の先頭からの秒**へ直す', () => {
    const { tail } = splitKeyframes(kf, 4);
    expect(tail[tail.length - 1]).toMatchObject({ timeSec: 6, x: 100 });
  });

  it('動きが無ければ何も作らない', () => {
    expect(splitKeyframes([], 4)).toEqual({ head: [], tail: [] });
  });

  it('**持っていない項目は焼かない**（切っただけで動く対象が増えない）', () => {
    const { head, tail } = splitKeyframes([{ timeSec: 0, opacity: 1 }, { timeSec: 10, opacity: 0 }], 4);
    expect(Object.keys(head[head.length - 1]).sort()).toEqual(['opacity', 'timeSec']);
    expect(Object.keys(tail[0]).sort()).toEqual(['opacity', 'timeSec']);
  });
});

describe('splitVolumePoints（音量の変化を分ける）', () => {
  it('切れ目の音量を両端に焼く', () => {
    const pts = [{ timeSec: 0, volume: 1 }, { timeSec: 10, volume: 0 }];
    const { head, tail } = splitVolumePoints(pts, 4, volumeAt(pts, 4));
    expect(head?.[head.length - 1]).toMatchObject({ timeSec: 4, volume: 0.6 });
    expect(tail?.[0]).toMatchObject({ timeSec: 0, volume: 0.6 });
    expect(tail?.[tail.length - 1]).toMatchObject({ timeSec: 6, volume: 0 });
  });

  it('点が無ければ何も持たせない（空の入れ物を作らない）', () => {
    expect(splitVolumePoints(undefined, 4, undefined)).toEqual({});
  });
});
