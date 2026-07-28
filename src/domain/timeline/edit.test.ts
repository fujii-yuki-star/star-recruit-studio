// タイムライン形式の編集操作（ADR-0032・#629）。置けないときに黙って別の結果にしないことを固定する。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import type { TimelineClip, TimelineProject } from './types';
import { TIMELINE_SCHEMA_VERSION } from './types';
import {
  addTrack, clipCountOnTrack, duplicateClip, EDIT_BLOCKED, isFreeSpan,
  moveClip, moveTrackOrder, removeClips, removeTrack, setTrackFlag, trimClip,
} from './edit';
import { TIMELINE_MIN_CLIP_SEC } from '../constants';

function clip(id: string, over: Partial<TimelineClip> = {}): TimelineClip {
  return { id, kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: 'あ', ...over };
}

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260728_001',
    projectName: 'テスト',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.visual },
      { id: 'track_003', kind: TRACK_KIND.audio },
    ],
    clips: [clip('clip_001')],
    ...over,
  };
}

const expectBlocked = (r: ReturnType<typeof moveClip>, reason: string): void => {
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe(reason);
};

describe('isFreeSpan（同じ列で時間が重ならない＝11 §8 V24）', () => {
  const clips = [clip('clip_001', { startSec: 2, durationSec: 3 })]; // [2, 5)
  it('端が接するだけなら置ける', () => {
    expect(isFreeSpan(clips, 'track_001', 5, 1)).toBe(true);
    expect(isFreeSpan(clips, 'track_001', 1, 1)).toBe(true);
  });
  it('少しでも重なると置けない', () => {
    expect(isFreeSpan(clips, 'track_001', 4.9, 1)).toBe(false);
    expect(isFreeSpan(clips, 'track_001', 1, 1.5)).toBe(false);
  });
  it('別の列なら重なってよい（重ねたいなら列を足す）', () => {
    expect(isFreeSpan(clips, 'track_002', 2, 3)).toBe(true);
  });
  it('自分自身とは重ならない（動かす当人を数えない）', () => {
    expect(isFreeSpan(clips, 'track_001', 3, 3, 'clip_001')).toBe(true);
  });
});

describe('moveClip', () => {
  it('同じ列で時間をずらす', () => {
    const r = moveClip(doc(), 'clip_001', { startSec: 10 });
    expect(r.ok && r.doc.clips[0].startSec).toBe(10);
  });

  it('何も変わらない移動は文書をそのまま返す（履歴を汚さない）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 0 })] });
    expect(moveClip(d, 'clip_001', { startSec: -5 }).ok && moveClip(d, 'clip_001', { startSec: -5 })).toMatchObject({ doc: d });
  });

  it('別の列へ移す', () => {
    const r = moveClip(doc(), 'clip_001', { trackId: 'track_002' });
    expect(r.ok && r.doc.clips[0].trackId).toBe('track_002');
  });

  it('重なる位置へは動かさない（勝手に寄せたり上書きしたりしない）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 0, durationSec: 5 }), clip('clip_002', { startSec: 6, durationSec: 5 })] });
    expectBlocked(moveClip(d, 'clip_001', { startSec: 4 }), EDIT_BLOCKED.overlap);
  });

  it('時間の外（0 より前）へは出さない', () => {
    const r = moveClip(doc(), 'clip_001', { startSec: -5 });
    expect(r.ok && r.doc.clips[0].startSec).toBe(0);
  });

  it('音の部品は映像の列に置けない（置いても鳴らない）', () => {
    const d = doc({ clips: [clip('clip_001', { kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_003', voice: { text: 'あ', status: 'none' } })] });
    expectBlocked(moveClip(d, 'clip_001', { trackId: 'track_001' }), EDIT_BLOCKED.trackKind);
  });

  it('固定した列のクリップは動かせない（移動先が固定でも同じ）', () => {
    const locked = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }, { id: 'track_002', kind: TRACK_KIND.visual }] });
    expectBlocked(moveClip(locked, 'clip_001', { startSec: 9 }), EDIT_BLOCKED.locked);
    const lockedTarget = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual, locked: true }] });
    expectBlocked(moveClip(lockedTarget, 'clip_001', { trackId: 'track_002' }), EDIT_BLOCKED.locked);
  });

  it('見つからないクリップは理由を返す（黙って何もしない、にしない）', () => {
    expectBlocked(moveClip(doc(), 'clip_999', { startSec: 1 }), EDIT_BLOCKED.notFound);
  });
});

describe('trimClip', () => {
  it('先頭を動かすと、終わりは動かない', () => {
    const r = trimClip(doc({ clips: [clip('clip_001', { startSec: 0, durationSec: 5 })] }), 'clip_001', 'start', 2);
    expect(r.ok && r.doc.clips[0]).toMatchObject({ startSec: 2, durationSec: 3 });
  });

  it('終わりを動かすと、先頭は動かない', () => {
    const r = trimClip(doc({ clips: [clip('clip_001', { startSec: 1, durationSec: 5 })] }), 'clip_001', 'end', 4);
    expect(r.ok && r.doc.clips[0]).toMatchObject({ startSec: 1, durationSec: 3 });
  });

  it('短くしすぎは最小の長さで止める（**下限を割らない**＝丸め誤差でも下回らせない）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 0, durationSec: 5 })] });
    const fromStart = trimClip(d, 'clip_001', 'start', 99);
    expect(fromStart.ok && fromStart.doc.clips[0].durationSec).toBe(TIMELINE_MIN_CLIP_SEC);
    const fromEnd = trimClip(d, 'clip_001', 'end', -99);
    expect(fromEnd.ok && fromEnd.doc.clips[0].durationSec).toBe(TIMELINE_MIN_CLIP_SEC);
  });

  it('端数の秒でも下限を割らない（長さを引き算してから丸めると割る）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 2, durationSec: 3 })] }); // [2, 5)
    const r = trimClip(d, 'clip_001', 'start', 4.95); // 残り 0.05 秒＝下限より短い
    expect(r.ok && r.doc.clips[0].durationSec).toBeGreaterThanOrEqual(TIMELINE_MIN_CLIP_SEC);
    const r2 = trimClip(doc({ clips: [clip('clip_001', { startSec: 0.3, durationSec: 3 })] }), 'clip_001', 'end', 0.4);
    expect(r2.ok && r2.doc.clips[0].durationSec).toBeGreaterThanOrEqual(TIMELINE_MIN_CLIP_SEC);
  });

  it('何も変わらないトリムは文書をそのまま返す（履歴を汚さない）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 2, durationSec: 3 })] });
    const r = trimClip(d, 'clip_001', 'end', 5);
    expect(r.ok && r.doc).toBe(d);
  });

  it('伸ばして隣と重なるなら止める', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 0, durationSec: 5 }), clip('clip_002', { startSec: 5, durationSec: 5 })] });
    expectBlocked(trimClip(d, 'clip_001', 'end', 7), EDIT_BLOCKED.overlap);
  });
});

describe('removeClips', () => {
  it('消したクリップへの参照（グループ・動き）も片づける', () => {
    const d = doc({
      clips: [clip('clip_001'), clip('clip_002', { trackId: 'track_002' })],
      groups: [{ id: 'group_001', members: ['clip_001', 'clip_002'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      animations: [
        { id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, opacity: 0 }] },
        { id: 'anim_002', targetId: 'group_001', keyframes: [{ timeSec: 0, opacity: 0 }] },
      ],
    });
    const next = removeClips(d, ['clip_001']);
    expect(next.clips.map((c) => c.id)).toEqual(['clip_002']);
    expect(next.groups![0].members).toEqual(['clip_002']); // メンバーから落ちる
    expect(next.animations!.map((a) => a.id)).toEqual(['anim_002']); // 消えた対象の動きは残さない
  });

  it('中身が無くなったグループは畳む（中身の無い入れ物を残さない）', () => {
    const d = doc({
      clips: [clip('clip_001')],
      groups: [{ id: 'group_001', members: ['clip_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      animations: [{ id: 'anim_001', targetId: 'group_001', keyframes: [{ timeSec: 0, opacity: 0 }] }],
    });
    const next = removeClips(d, ['clip_001']);
    expect(next.groups).toBeUndefined();
    expect(next.animations).toBeUndefined(); // 対象が消えた動きも残らない
  });
});

describe('トラック（列）', () => {
  it('足した列はいちばん手前（配列の末尾）に入る', () => {
    const next = addTrack(doc(), TRACK_KIND.audio);
    expect(next.tracks[next.tracks.length - 1]).toMatchObject({ id: 'track_004', kind: TRACK_KIND.audio });
  });

  it('消すと、その列のクリップも一緒に消える（数は事前に分かる）', () => {
    const d = doc({ clips: [clip('clip_001'), clip('clip_002', { trackId: 'track_002' })] });
    expect(clipCountOnTrack(d, 'track_001')).toBe(1);
    const r = removeTrack(d, 'track_001');
    expect(r.ok && r.doc.tracks.map((t) => t.id)).toEqual(['track_002', 'track_003']);
    expect(r.ok && r.doc.clips.map((c) => c.id)).toEqual(['clip_002']);
  });

  it('固定した列は消せない（動かせないのに消せる、を作らない）', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] });
    expectBlocked(removeTrack(d, 'track_001'), EDIT_BLOCKED.locked);
  });

  it('重ね順を1つ動かす（端では何も起きない）', () => {
    const d = doc();
    expect(moveTrackOrder(d, 'track_001', 'front').tracks.map((t) => t.id)).toEqual(['track_002', 'track_001', 'track_003']);
    expect(moveTrackOrder(d, 'track_001', 'back').tracks.map((t) => t.id)).toEqual(['track_001', 'track_002', 'track_003']);
  });

  it('表示/固定を切り替える', () => {
    expect(setTrackFlag(doc(), 'track_001', 'hidden', true).tracks[0].hidden).toBe(true);
    expect(setTrackFlag(doc(), 'track_001', 'locked', true).tracks[0].locked).toBe(true);
  });
});

describe('duplicateClip', () => {
  it('同じ列の直後へ複製する（新しい id が付く）', () => {
    const r = duplicateClip(doc({ clips: [clip('clip_001', { startSec: 0, durationSec: 5 })] }), 'clip_001');
    expect(r.ok && r.doc.clips[1]).toMatchObject({ id: 'clip_002', startSec: 5, durationSec: 5, trackId: 'track_001' });
  });

  it('読み上げは作成済みの音声を引き継がない（別の部品の音声を指さない）', () => {
    const d = doc({
      tracks: [{ id: 'track_003', kind: TRACK_KIND.audio }],
      clips: [clip('clip_001', { kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_003', voice: { text: 'あ', status: 'generated', voicePath: 'voices/a.wav' } })],
    });
    const r = duplicateClip(d, 'clip_001');
    expect(r.ok && r.doc.clips[1].voice).toEqual({ text: 'あ', status: 'none', voicePath: null });
  });

  it('直後が空いていなければ置けない（勝手に別の場所へ置かない）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 0, durationSec: 5 }), clip('clip_002', { startSec: 5, durationSec: 5 })] });
    expectBlocked(duplicateClip(d, 'clip_001'), EDIT_BLOCKED.overlap);
  });
});
