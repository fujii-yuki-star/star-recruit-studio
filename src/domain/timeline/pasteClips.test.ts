// 写しておいた部品を貼る（#1265）＝複製と同じ規則・全か無か・列と間隔はそのまま。
import { describe, expect, it } from 'vitest';
import { EDIT_BLOCKED, pasteClips } from './edit';
import { NARRATION_STATUS, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';

const text = (id: string, trackId: string, startSec: number, durationSec = 2): TimelineClip =>
  ({ id, kind: TIMELINE_CLIP_KIND.text, trackId, startSec, durationSec, x: 0, y: 0, w: 10, h: 10, text: id }) as TimelineClip;
function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: 'proj_20260929_001', projectName: 't',
    createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' }, assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }, { id: 'track_003', kind: TRACK_KIND.audio }],
    clips: [text('clip_001', 'track_001', 0), text('clip_002', 'track_002', 1)],
    ...over,
  } as TimelineProject;
}

describe('pasteClips（#1265）', () => {
  it('いちばん早い部品を貼る時刻へ合わせ、列と間隔はそのまま・新しい id', () => {
    const d = doc();
    const r = pasteClips(d, [d.clips[0], d.clips[1]], 10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pasted = r.doc.clips.filter((c) => r.pastedIds.includes(c.id));
    expect(pasted.map((c) => [c.trackId, c.startSec])).toEqual([['track_001', 10], ['track_002', 11]]);
    expect(new Set([...d.clips.map((c) => c.id), ...r.pastedIds]).size, 'id が重なった').toBe(4);
  });

  // ⚠️ **全か無か**（ADR-0034 決定15）。
  it('1つでも重なれば何も貼らない', () => {
    const d = doc({ clips: [text('clip_001', 'track_001', 0), text('clip_002', 'track_002', 1), text('clip_009', 'track_002', 11)] });
    const r = pasteClips(d, [d.clips[0], d.clips[1]], 10); // 2つ目が 11秒の帯と重なる
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe(EDIT_BLOCKED.overlap);
  });

  it('固定・隠した列へは貼らない（新しく作る側の規則）', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }, { id: 'track_002', kind: TRACK_KIND.visual }] });
    const r = pasteClips(d, [d.clips[0]], 10);
    expect(!r.ok && r.reason).toBe(EDIT_BLOCKED.locked);
  });

  it('写した後に消えた列・素材は断る', () => {
    const gone = text('clip_x', 'track_404', 0);
    expect(pasteClips(doc(), [gone], 10).ok).toBe(false);
    const slot = { id: 'clip_s', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 2, x: 0, y: 0, w: 1, h: 1, assetId: 'asset_404' } as TimelineClip;
    expect(pasteClips(doc(), [slot], 10).ok).toBe(false);
  });

  // 複製と同じ規則（`freshClipCopy` を共有）＝読み上げの作成済みの音声は引き継がない。
  it('読み上げは作成済みの音声を引き継がない', () => {
    const voice = { id: 'clip_v', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_003', startSec: 0, durationSec: 2, voice: { text: 'あ', status: NARRATION_STATUS.generated, voicePath: 'voice/a.wav' } } as TimelineClip;
    const d = doc({ clips: [voice] });
    const r = pasteClips(d, [voice], 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.doc.clips.find((c) => c.id === r.pastedIds[0])!;
    expect(p.voice?.voicePath).toBeNull();
    expect(p.voice?.status).toBe(NARRATION_STATUS.none);
  });

  it('空は断る・負の時刻は 0 から', () => {
    expect(pasteClips(doc(), [], 0).ok).toBe(false);
    const d = doc({ clips: [text('clip_001', 'track_001', 5)] });
    const r = pasteClips(d, [d.clips[0]], -3);
    expect(r.ok && r.doc.clips.find((c) => c.id === r.pastedIds[0])!.startSec).toBe(0);
  });
});
