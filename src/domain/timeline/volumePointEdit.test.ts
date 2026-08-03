// 音量の変化の編集（#512 段4）。置く・直す・外すの規則＝キーフレームと同じ流儀。
import { describe, expect, it } from 'vitest';

import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { VOLUME_POINTS_MAX } from '../constants';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { EDIT_BLOCKED } from './edit';
import { clearVolumePoints, removeVolumePoint, setVolumePoint, volumePointTimeAt } from './volumePointEdit';
import { TIMELINE_EXPORT_BLOCK, timelineExportBlockers } from './export';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';

const doc = (over: Partial<TimelineClip> = {}, trackOver: { locked?: boolean } = {}): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: 'proj_20260803_001',
  projectName: 'テスト',
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/a.mp3' }],
  tracks: [
    { id: 'track_001', kind: TRACK_KIND.audio, ...trackOver },
    { id: 'track_002', kind: TRACK_KIND.visual },
  ],
  clips: [
    { id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_001', startSec: 0, durationSec: 8, assetId: 'asset_001', ...over },
    { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002', startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: 'あ' },
  ],
});

const pointsOf = (d: TimelineProject) => d.clips[0].volumePoints;

describe('setVolumePoint（置く・直す）', () => {
  it('置いた点が保存でき、スキーマも通る', () => {
    const r = setVolumePoint(doc(), 'clip_001', 2, 0.4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pointsOf(r.doc)).toEqual([{ timeSec: 2, volume: 0.4 }]);
    expect(validateTimelineProject(r.doc)).toBe(true);
  });

  it('同じ時刻に置くと差し替える（点は増えない）', () => {
    const first = setVolumePoint(doc(), 'clip_001', 2, 0.4);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = setVolumePoint(first.doc, 'clip_001', 2, 0.9);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(pointsOf(second.doc)).toEqual([{ timeSec: 2, volume: 0.9 }]);
  });

  it('部品の外の時刻は範囲へ収める（鳴らない位置に置かない）', () => {
    const r = setVolumePoint(doc(), 'clip_001', 99, 0.5);
    expect(r.ok && pointsOf(r.doc)).toEqual([{ timeSec: 8, volume: 0.5 }]);
    const back = setVolumePoint(doc(), 'clip_001', -3, 0.5);
    expect(back.ok && pointsOf(back.doc)).toEqual([{ timeSec: 0, volume: 0.5 }]);
  });

  it('音量は保存できる範囲へ収める（schema を通らない文書を作らない）', () => {
    const r = setVolumePoint(doc(), 'clip_001', 1, 9);
    expect(r.ok && pointsOf(r.doc)).toEqual([{ timeSec: 1, volume: 1.5 }]);
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('上限に達したら置かずに理由を返す（置けたのに書き出せない、を作らない）', () => {
    const full = Array.from({ length: VOLUME_POINTS_MAX }, (_, i) => ({ timeSec: i * 0.1, volume: 0.5 }));
    const r = setVolumePoint(doc({ volumePoints: full }), 'clip_001', 7, 0.2);
    expect(r).toEqual({ ok: false, reason: EDIT_BLOCKED.volumePointsFull });
  });

  it('上限に達していても、すでにある時刻の置き直しはできる（数が増えないため）', () => {
    const full = Array.from({ length: VOLUME_POINTS_MAX }, (_, i) => ({ timeSec: i * 0.1, volume: 0.5 }));
    const r = setVolumePoint(doc({ volumePoints: full }), 'clip_001', 0.1, 0.9);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pointsOf(r.doc)).toHaveLength(VOLUME_POINTS_MAX);
    expect(pointsOf(r.doc)?.find((p) => p.timeSec === 0.1)?.volume).toBe(0.9);
  });

  it('固定した列の部品は変えられない', () => {
    const r = setVolumePoint(doc({}, { locked: true }), 'clip_001', 1, 0.5);
    expect(r).toEqual({ ok: false, reason: EDIT_BLOCKED.locked });
  });

  it('鳴る音を持たない部品には置けない（黙って意味の無いデータを書かない）', () => {
    const r = setVolumePoint(doc(), 'clip_002', 1, 0.5);
    expect(r).toEqual({ ok: false, reason: EDIT_BLOCKED.volumePointsKind });
  });

  it('無い部品は理由を返す（消された直後の操作）', () => {
    expect(setVolumePoint(doc(), 'clip_none', 1, 0.5)).toEqual({ ok: false, reason: EDIT_BLOCKED.notFound });
  });

  it('同じ値の置き直しは同じ文書を返す（取り消しが空振りしない）', () => {
    const base = doc({ volumePoints: [{ timeSec: 2, volume: 0.4 }] });
    const r = setVolumePoint(base, 'clip_001', 2, 0.4);
    expect(r.ok && r.doc).toBe(base);
  });
});

describe('removeVolumePoint / clearVolumePoints（外す）', () => {
  it('外すと点が減り、最後の1つを外すとキーごと消える（一定の音量へ戻る）', () => {
    const base = doc({ volumePoints: [{ timeSec: 1, volume: 0.2 }, { timeSec: 3, volume: 0.8 }] });
    const one = removeVolumePoint(base, 'clip_001', 1);
    expect(one.ok && pointsOf(one.doc)).toEqual([{ timeSec: 3, volume: 0.8 }]);
    const none = one.ok ? removeVolumePoint(one.doc, 'clip_001', 3) : one;
    expect(none.ok && pointsOf(none.doc)).toBeUndefined();
  });

  it('無い時刻を外しても文書は変わらない', () => {
    const base = doc({ volumePoints: [{ timeSec: 1, volume: 0.2 }] });
    const r = removeVolumePoint(base, 'clip_001', 5);
    expect(r.ok && r.doc).toBe(base);
  });

  it('すべて外すとキーごと消える', () => {
    const base = doc({ volumePoints: [{ timeSec: 1, volume: 0.2 }, { timeSec: 3, volume: 0.8 }] });
    const r = clearVolumePoints(base, 'clip_001');
    expect(r.ok && pointsOf(r.doc)).toBeUndefined();
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('固定した列の部品は外せない', () => {
    const base = doc({ volumePoints: [{ timeSec: 1, volume: 0.2 }] }, { locked: true });
    expect(clearVolumePoints(base, 'clip_001')).toEqual({ ok: false, reason: EDIT_BLOCKED.locked });
  });
});

describe('書き出しの停止と数え方をそろえる（/canon-check の指摘）', () => {
  it('絵の部品に点が入っていても書き出しは止めない（式は組まれない＝出せるものを断らない）', () => {
    const many = Array.from({ length: VOLUME_POINTS_MAX + 5 }, (_, i) => ({ timeSec: i * 0.05, volume: 0.5 }));
    const d = doc();
    const withPointsOnText: TimelineProject = {
      ...d,
      clips: d.clips.map((c) => (c.id === 'clip_002' ? { ...c, volumePoints: many } : c)),
    };
    expect(timelineExportBlockers(withPointsOnText)).toEqual([]);
  });

  it('音の部品なら同じ数で止める（置ける数と数え方が一致する）', () => {
    const many = Array.from({ length: VOLUME_POINTS_MAX + 5 }, (_, i) => ({ timeSec: i * 0.05, volume: 0.5 }));
    expect(timelineExportBlockers(doc({ volumePoints: many })).map((b) => b.code))
      .toEqual([TIMELINE_EXPORT_BLOCK.volumePointsTooMany]);
  });
});

describe('volumePointTimeAt（置ける位置か・#512 実機確認で判明）', () => {
  const clip = doc({ startSec: 2, durationSec: 8 }).clips[0];

  it('終わりちょうども置ける（「だんだん大きく」の到達点を置けなくしない）', () => {
    expect(volumePointTimeAt(clip, 10)).toBe(8);
  });

  it('始まりちょうども置ける', () => {
    expect(volumePointTimeAt(clip, 2)).toBe(0);
  });

  it('部品の外は置けない', () => {
    expect(volumePointTimeAt(clip, 1.9)).toBeNull();
    expect(volumePointTimeAt(clip, 10.1)).toBeNull();
  });

  it('返す秒はそのまま setVolumePoint に渡せる（切り詰められない＝同じ規則）', () => {
    const base = doc({ startSec: 2, durationSec: 8 });
    const r = setVolumePoint(base, 'clip_001', volumePointTimeAt(clip, 10)!, 1);
    expect(r.ok && r.doc.clips[0].volumePoints).toEqual([{ timeSec: 8, volume: 1 }]);
  });
});

describe('volumePointTimeAt の端（/canon-check の指摘）', () => {
  it('丸めの都合で右端ちょうどが外れない（案内どおりの秒で置ける）', () => {
    // (0.1 + 0.2) - 0.1 は 0.20000000000000004＝長さ 0.2 を超える。式を変えないと右端が外れる。
    const clip = doc({ startSec: 0.1, durationSec: 0.2 }).clips[0];
    expect(volumePointTimeAt(clip, 0.1 + 0.2)).not.toBeNull();
    expect(volumePointTimeAt(clip, 0.1 + 0.2)!).toBeLessThanOrEqual(0.2);
  });

  it('部品を動かしても同じ点は同じ秒になる（置き直しが点を増やさない）', () => {
    const before = doc({ startSec: 0, durationSec: 100 }).clips[0];
    const moved = doc({ startSec: 81.242, durationSec: 100 }).clips[0];
    const local = volumePointTimeAt(before, 5.765)!;
    expect(volumePointTimeAt(moved, 81.242 + local)).toBe(local);
  });
});
