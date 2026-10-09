// 運んだ先へ写しを置く（#1248・Alt＋運ぶ）＝元は残る・複製と同じ規則・全か無か。
import { describe, expect, it } from 'vitest';
import { copyClipsTo, EDIT_BLOCKED } from './edit';
import { NARRATION_STATUS, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';

const text = (id: string, trackId: string, startSec: number, durationSec = 2): TimelineClip =>
  ({ id, kind: TIMELINE_CLIP_KIND.text, trackId, startSec, durationSec, x: 0, y: 0, w: 10, h: 10, text: id }) as TimelineClip;
function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: 'proj_20261009_001', projectName: 't',
    createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' }, assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }, { id: 'track_003', kind: TRACK_KIND.audio }],
    clips: [text('clip_001', 'track_001', 0), text('clip_002', 'track_002', 1)],
    ...over,
  } as TimelineProject;
}

describe('copyClipsTo（#1248）', () => {
  it('元はそのまま残り、写しが運んだ先（時刻・列）に新しい id で増える', () => {
    const d = doc();
    const r = copyClipsTo(d, [{ id: 'clip_001', startSec: 5, trackId: 'track_002' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.clips.find((c) => c.id === 'clip_001')).toEqual(d.clips[0]);
    const copy = r.doc.clips.find((c) => c.id === r.copiedIds[0])!;
    expect([copy.trackId, copy.startSec, copy.durationSec, (copy as { text?: string }).text]).toEqual(['track_002', 5, 2, 'clip_001']);
    expect(r.doc.clips).toHaveLength(3);
  });

  it('列を省けば元と同じ列に置く', () => {
    const r = copyClipsTo(doc(), [{ id: 'clip_001', startSec: 4 }]);
    expect(r.ok && r.doc.clips.find((c) => c.id === r.copiedIds[0])!.trackId).toBe('track_001');
  });

  // ⚠️ **元も重なりの相手**＝元は残るので、少しだけ運んだ写しは元と重なる。
  it('元と重なる所へは置かない（押しのけない）', () => {
    expect(copyClipsTo(doc(), [{ id: 'clip_001', startSec: 1 }])).toEqual({ ok: false, reason: EDIT_BLOCKED.overlap });
  });

  // ⚠️ **全か無か**（ADR-0034 決定15）。
  it('まとめて写すとき、1つでも置けなければ何も置かない', () => {
    const d = doc();
    const r = copyClipsTo(d, [{ id: 'clip_001', startSec: 10 }, { id: 'clip_002', startSec: 0 }]); // 2つ目が元の clip_002（1秒）と重なる
    expect(r).toEqual({ ok: false, reason: EDIT_BLOCKED.overlap });
  });

  it('まとめて写した写しどうしも重ならないように見る（先に置いた写しも相手に数える）', () => {
    const d = doc({ clips: [text('clip_001', 'track_001', 0), text('clip_002', 'track_001', 3)] });
    const r = copyClipsTo(d, [{ id: 'clip_001', startSec: 10, trackId: 'track_002' }, { id: 'clip_002', startSec: 11, trackId: 'track_002' }]);
    expect(r).toEqual({ ok: false, reason: EDIT_BLOCKED.overlap });
  });

  it('固定・隠した列、種類の違う列へは置かない（新しく作る側の規則）', () => {
    const locked = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual, locked: true }, { id: 'track_003', kind: TRACK_KIND.audio }] });
    expect(copyClipsTo(locked, [{ id: 'clip_001', startSec: 10, trackId: 'track_002' }])).toEqual({ ok: false, reason: EDIT_BLOCKED.locked });
    const hidden = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual, hidden: true }, { id: 'track_003', kind: TRACK_KIND.audio }] });
    expect(copyClipsTo(hidden, [{ id: 'clip_001', startSec: 10, trackId: 'track_002' }])).toEqual({ ok: false, reason: EDIT_BLOCKED.hiddenTrack });
    expect(copyClipsTo(doc(), [{ id: 'clip_001', startSec: 10, trackId: 'track_003' }])).toEqual({ ok: false, reason: EDIT_BLOCKED.trackKind });
  });

  it('0秒より前へは置かない（0秒に寄せる）', () => {
    const r = copyClipsTo(doc({ clips: [text('clip_001', 'track_001', 5)] }), [{ id: 'clip_001', startSec: -3, trackId: 'track_002' }]);
    expect(r.ok && r.doc.clips.find((c) => c.id === r.copiedIds[0])!.startSec).toBe(0);
  });

  it('無い部品は断る', () => {
    expect(copyClipsTo(doc(), [{ id: 'clip_404', startSec: 10 }])).toEqual({ ok: false, reason: EDIT_BLOCKED.notFound });
    expect(copyClipsTo(doc(), [])).toEqual({ ok: false, reason: EDIT_BLOCKED.notFound });
  });

  // 複製と同じ規則（`freshClipCopy` を共有）。
  it('読み上げは作成済みの音声を引き継がない', () => {
    const voice = { id: 'clip_v', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_003', startSec: 0, durationSec: 2, voice: { text: 'あ', status: NARRATION_STATUS.generated, voicePath: 'voice/a.wav' } } as TimelineClip;
    const r = copyClipsTo(doc({ clips: [voice] }), [{ id: 'clip_v', startSec: 5 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const copy = r.doc.clips.find((c) => c.id === r.copiedIds[0])!;
    expect(copy.voice).toEqual({ text: 'あ', status: NARRATION_STATUS.none, voicePath: null });
  });
});
