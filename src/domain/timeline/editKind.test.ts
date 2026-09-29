// 取り消す／やり直すの中身の種類（#1268）＝前後の文書を比べて決める。
import { describe, expect, it } from 'vitest';
import { TIMELINE_EDIT_KIND, timelineEditKind } from './editKind';
import { duplicateClip, duplicateTrack, moveTrackOrder, removeTrack } from './edit';
import { splitClip } from './split';
import { volumeAt } from './audio';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineProject } from './types';

const clip = { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: 'あ' };
function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: 'proj_20260929_001', projectName: 't',
    createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' }, assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }], clips: [clip] as TimelineProject['clips'], ...over,
  } as TimelineProject;
}
const withClip = (patch: Record<string, unknown>) => doc({ clips: [{ ...clip, ...patch }] as TimelineProject['clips'] });

describe('timelineEditKind（#1268）', () => {
  it.each([
    ['部品が増えた', doc({ clips: [] }), doc(), TIMELINE_EDIT_KIND.place],
    ['部品が減った', doc(), doc({ clips: [] }), TIMELINE_EDIT_KIND.remove],
    ['開始が変わった', doc(), withClip({ startSec: 2 }), TIMELINE_EDIT_KIND.move],
    ['列が変わった', doc(), withClip({ trackId: 'track_002' }), TIMELINE_EDIT_KIND.move],
    ['長さだけ変わった', doc(), withClip({ durationSec: 5 }), TIMELINE_EDIT_KIND.resize],
    ['箱だけ変わった', doc(), withClip({ x: 40 }), TIMELINE_EDIT_KIND.box],
    ['中身だけ変わった', doc(), withClip({ text: 'い' }), TIMELINE_EDIT_KIND.content],
    ['列が増えた', doc(), doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }] }), TIMELINE_EDIT_KIND.addTrack],
    ['列が減った', doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }] }), doc(), TIMELINE_EDIT_KIND.removeTrack],
    ['列の設定が変わった', doc(), doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] }), TIMELINE_EDIT_KIND.track],
    ['目印が変わった', doc(), doc({ markers: [{ id: 'marker_001', timeSec: 1 }] }), TIMELINE_EDIT_KIND.marker],
    ['動画全体の設定が変わった', doc(), doc({ videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 30, maxDurationSec: 600 } }), TIMELINE_EDIT_KIND.settings],
    ['元が消えて増えた（バラす等）', doc(), doc({ clips: [{ ...clip, id: 'clip_002' }] as TimelineProject['clips'] }), TIMELINE_EDIT_KIND.other],
  ])('%s', (_n, before, after, kind) => {
    expect(timelineEditKind(before, after)).toBe(kind);
  });

  // ⚠️ **目立つ方を先に**＝部品が増えつつ列も増えた（重ねて置いた）は「部品を置く」。
  it('部品が増え、列も増えたときは「部品を置く」', () => {
    const after = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }], clips: [clip, { ...clip, id: 'clip_002', trackId: 'track_002' }] as TimelineProject['clips'] });
    expect(timelineEditKind(doc(), after)).toBe(TIMELINE_EDIT_KIND.place);
  });
});

// ⚠️ **実物の編集関数の出力で見る**（#1270 レビュー 🔴）＝手書きの文書だけだと、分けたときに「部品を置く」と
//   出ていたのを見逃した（`splitClip` は元の id を前半に残し、後半にだけ新しい id を付ける）。
describe('timelineEditKind（実物の編集で・#1270 レビュー）', () => {
  // 列2には部品を2つ（列の複製は「2つ以上」で見分ける＝置くときの1つと取り違えない）。
  const two = () => doc({
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }],
    clips: [clip, { ...clip, id: 'clip_002', trackId: 'track_002' }, { ...clip, id: 'clip_003', trackId: 'track_002', startSec: 4 }] as TimelineProject['clips'],
  });
  const ok = <T extends { ok: boolean }>(r: T) => { expect(r.ok).toBe(true); return r as Extract<T, { ok: true }>; };

  it('分ける → split', () => {
    const d = doc();
    const r = ok(splitClip(d, 'clip_001', 1.5, volumeAt));
    expect(timelineEditKind(d, r.doc)).toBe(TIMELINE_EDIT_KIND.split);
  });
  it('複製 → duplicate（分けると取り違えない）', () => {
    const d = doc();
    expect(timelineEditKind(d, ok(duplicateClip(d, 'clip_001')).doc)).toBe(TIMELINE_EDIT_KIND.duplicate);
  });
  it('部品の入った列を消す → removeTrack（「部品を削除」と言わない）', () => {
    const d = two();
    expect(timelineEditKind(d, ok(removeTrack(d, 'track_002')).doc)).toBe(TIMELINE_EDIT_KIND.removeTrack);
  });
  it('列の複製 → duplicateTrack', () => {
    const d = two();
    expect(timelineEditKind(d, ok(duplicateTrack(d, 'track_002')).doc)).toBe(TIMELINE_EDIT_KIND.duplicateTrack);
  });
  it('列の並べ替え → reorderTracks', () => {
    const d = two();
    expect(timelineEditKind(d, ok(moveTrackOrder(d, 'track_001', 'front')).doc)).toBe(TIMELINE_EDIT_KIND.reorderTracks);
  });
});
