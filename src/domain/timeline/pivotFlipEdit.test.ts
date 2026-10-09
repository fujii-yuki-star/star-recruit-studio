// 部品の反転と動きの支点を直す（ADR-0059）＝戻したらキーごと落とす・絵の無い部品には無い・固定は断る。
import { describe, expect, it } from 'vitest';
import { EDIT_BLOCKED, setClipFlip, setClipPivot } from './edit';
import { CLIP_PIVOT_PRESETS, pivotPresetOf } from './pivot';
import { clampProp } from './keyframeEdit';
import { GROUP_MIN_SCALE } from '../constants';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';

const shape = { id: 'clip_001', kind: TIMELINE_CLIP_KIND.shape, trackId: 'track_001', startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, shapeType: 'rect' } as TimelineClip;
const voice = { id: 'clip_002', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 2, voice: { text: 'あ', status: 'none' } } as TimelineClip;
function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: 'proj_20261009_001', projectName: 't',
    createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' }, assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips: [shape, voice], ...over,
  } as TimelineProject;
}
const clipOf = (r: ReturnType<typeof setClipFlip>, id = 'clip_001') => (r.ok ? r.doc.clips.find((c) => c.id === id) : undefined);

describe('setClipFlip', () => {
  it('入れると true・戻すとキーごと落とす（取り消しが空振りしない）', () => {
    const on = setClipFlip(doc(), 'clip_001', 'x', true);
    expect(clipOf(on)?.flipX).toBe(true);
    const off = setClipFlip(on.ok ? on.doc : doc(), 'clip_001', 'x', false);
    expect(clipOf(off) && 'flipX' in clipOf(off)!).toBe(false);
    expect(clipOf(setClipFlip(doc(), 'clip_001', 'y', true))?.flipY).toBe(true);
  });
  it('変わらなければ同じ文書を返す', () => {
    const d = doc();
    const r = setClipFlip(d, 'clip_001', 'x', false);
    expect(r.ok && r.doc).toBe(d);
  });
  it('絵の無い部品・固定した列・無い部品は断る', () => {
    expect(setClipFlip(doc(), 'clip_002', 'x', true)).toMatchObject({ ok: false, reason: EDIT_BLOCKED.contentField });
    expect(setClipFlip(doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }, { id: 'track_002', kind: TRACK_KIND.audio }] }), 'clip_001', 'x', true))
      .toMatchObject({ ok: false, reason: EDIT_BLOCKED.locked });
    expect(setClipFlip(doc(), 'clip_404', 'x', true)).toMatchObject({ ok: false, reason: EDIT_BLOCKED.notFound });
  });
});

describe('setClipPivot', () => {
  it('入れる・中心か null へ戻すとキーごと落とす・範囲へ収める', () => {
    const r = setClipPivot(doc(), 'clip_001', { x: 0.5, y: 1 });
    expect(clipOf(r)?.pivot).toEqual({ x: 0.5, y: 1 });
    const back = setClipPivot(r.ok ? r.doc : doc(), 'clip_001', { x: 0.5, y: 0.5 });
    expect(clipOf(back) && 'pivot' in clipOf(back)!).toBe(false);
    const nul = setClipPivot(r.ok ? r.doc : doc(), 'clip_001', null);
    expect(clipOf(nul) && 'pivot' in clipOf(nul)!).toBe(false);
    expect(clipOf(setClipPivot(doc(), 'clip_001', { x: -1, y: 3 }))?.pivot).toEqual({ x: 0, y: 1 });
  });
  it('変わらなければ同じ文書を返す', () => {
    const d = doc();
    expect((setClipPivot(d, 'clip_001', null) as { doc: TimelineProject }).doc).toBe(d);
  });
  it('絵の無い部品・固定した列は断る', () => {
    expect(setClipPivot(doc(), 'clip_002', { x: 0, y: 0 })).toMatchObject({ ok: false, reason: EDIT_BLOCKED.contentField });
    expect(setClipPivot(doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }, { id: 'track_002', kind: TRACK_KIND.audio }] }), 'clip_001', { x: 0, y: 0 }))
      .toMatchObject({ ok: false, reason: EDIT_BLOCKED.locked });
  });
});

describe('pivotPresetOf', () => {
  it('未指定は中心・選び先に当たればその名前・半端な値は null', () => {
    expect(pivotPresetOf(undefined)).toBe('center');
    for (const p of CLIP_PIVOT_PRESETS) expect(pivotPresetOf({ x: p.x, y: p.y })).toBe(p.id);
    expect(pivotPresetOf({ x: 0.3, y: 0.7 })).toBeNull();
  });
});

describe('clampProp の横・縦だけの倍率（ADR-0059 段階2）', () => {
  it('負はそのまま（反転）・0 に近い値は符号を保って下限へ・0 ちょうどは正の側', () => {
    expect(clampProp('scaleX', -1)).toBe(-1);
    expect(clampProp('scaleY', 2)).toBe(2);
    expect(clampProp('scaleX', -GROUP_MIN_SCALE / 2)).toBe(-GROUP_MIN_SCALE);
    expect(clampProp('scaleY', GROUP_MIN_SCALE / 2)).toBe(GROUP_MIN_SCALE);
    expect(clampProp('scaleX', 0)).toBe(GROUP_MIN_SCALE);
  });
});
