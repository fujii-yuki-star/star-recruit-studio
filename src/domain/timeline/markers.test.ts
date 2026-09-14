// 時間の一点に置く**目印**（#356 ①）。
import { describe, expect, it } from 'vitest';
import { addMarker, markerAt, markersInOrder, MARKER_TEXT_MAX, moveMarker, removeMarker, setMarkerText } from './markers';
import { PROJECT_FORMAT, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { validateTimelineProject } from '../validation/generated/validators.js';
import type { TimelineProject } from './types';

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260914_001',
    projectName: 'テスト',
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips: [],
    ...over,
  };
}

describe('addMarker（再生位置に目印を置く）', () => {
  it('置いた時刻の目印が増える', () => {
    const r = addMarker(doc(), 4);
    expect(r.doc.markers).toHaveLength(1);
    expect(r.doc.markers![0]!.timeSec).toBe(4);
    expect(r.doc.markers![0]!.id).toMatch(/^marker_\d{3,}$/);
  });

  // ⚠️ **同じ時刻に2つ置けると、どちらを直しているか分からなくなる**（一覧でも重なって見える）。
  it('同じ時刻には重ねない（既にあるものを返す）', () => {
    const first = addMarker(doc(), 4);
    const second = addMarker(first.doc, 4);
    expect(second.doc.markers, '同じ時刻に2つ置いている').toHaveLength(1);
    expect(second.markerId, '既にある目印を指していない').toBe(first.markerId);
  });

  // ⚠️ **番号は使い回してよい**＝素材（`reserveAssetId`）と違い、目印は**ディスクに実体が無い**。
  // 使い回しても前の何かを潰さないので、文書の中だけで一意なら足りる（§2-7・11 §2.1）。
  it('文書の中で一意（同時に同じ番号は作らない）', () => {
    const a = addMarker(doc(), 1);
    const b = addMarker(a.doc, 2);
    expect(b.markerId).not.toBe(a.markerId);
    expect(new Set(b.doc.markers!.map((m) => m.id)).size).toBe(2);
  });

  it('できた文書は正典（schema）に通る', () => {
    const r = addMarker(doc(), 4);
    const withText = setMarkerText(r.doc, r.markerId, 'ここ直す');
    expect(validateTimelineProject(withText), JSON.stringify(validateTimelineProject.errors)).toBe(true);
  });
});

describe('setMarkerText（メモを書く）', () => {
  it('メモを書ける', () => {
    const r = addMarker(doc(), 4);
    const d = setMarkerText(r.doc, r.markerId, 'ここに効果音');
    expect(d.markers![0]!.text).toBe('ここに効果音');
  });

  // ⚠️ **上限で切る**＝超えると**保存はできて次に開けない**（#974 の型）。断るのではなく収める。
  it('長すぎるメモは切る（開けない文書を作らない）', () => {
    const r = addMarker(doc(), 4);
    const d = setMarkerText(r.doc, r.markerId, 'あ'.repeat(MARKER_TEXT_MAX + 50));
    expect(d.markers![0]!.text).toHaveLength(MARKER_TEXT_MAX);
    expect(validateTimelineProject(d), JSON.stringify(validateTimelineProject.errors)).toBe(true);
  });

  it('別の目印には書かない', () => {
    const a = addMarker(doc(), 1);
    const b = addMarker(a.doc, 2);
    const d = setMarkerText(b.doc, b.markerId, 'あとの方');
    expect(d.markers!.find((m) => m.id === a.markerId)!.text).toBeUndefined();
  });
});

describe('moveMarker（目印を動かす）', () => {
  it('時刻を変えられる', () => {
    const r = addMarker(doc(), 4);
    expect(moveMarker(r.doc, r.markerId, 9).markers![0]!.timeSec).toBe(9);
  });

  // ⚠️ **負にすると保存はできて次に開けない**（schema は 0 以上）。
  it('0 より前へは動かさない', () => {
    const r = addMarker(doc(), 4);
    const d = moveMarker(r.doc, r.markerId, -3);
    expect(d.markers![0]!.timeSec).toBe(0);
    expect(validateTimelineProject(d), JSON.stringify(validateTimelineProject.errors)).toBe(true);
  });

  it('ほかの目印と同じ時刻へは重ねない', () => {
    const a = addMarker(doc(), 1);
    const b = addMarker(a.doc, 2);
    const d = moveMarker(b.doc, b.markerId, 1);
    expect(d.markers!.find((m) => m.id === b.markerId)!.timeSec, '同じ時刻に重ねている').toBe(2);
  });
});

describe('markersInOrder / markerAt', () => {
  it('時刻順に並べる（置いた順ではない）', () => {
    const a = addMarker(doc(), 9);
    const b = addMarker(a.doc, 2);
    expect(markersInOrder(b.doc).map((m) => m.timeSec)).toEqual([2, 9]);
  });

  it('その時刻の目印を探せる', () => {
    const r = addMarker(doc(), 4);
    expect(markerAt(r.doc, 4)!.id).toBe(r.markerId);
    expect(markerAt(r.doc, 5)).toBeUndefined();
  });

  it('1つも無くても落ちない', () => {
    expect(markersInOrder(doc())).toEqual([]);
    expect(markerAt(doc(), 0)).toBeUndefined();
  });
});

describe('removeMarker（目印を消す）', () => {
  it('その目印だけ消える', () => {
    const a = addMarker(doc(), 1);
    const b = addMarker(a.doc, 2);
    const d = removeMarker(b.doc, a.markerId);
    expect(d.markers!.map((m) => m.id)).toEqual([b.markerId]);
  });
});
