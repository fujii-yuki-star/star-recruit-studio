// 喋っている間の動き（ADR-0056・#1367）。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { EDIT_BLOCKED, pasteClips, removeTrack, setClipTalkMotion } from './edit';
import { explodeTemplateClip } from './explode';
import { validateTimelineDoc } from './validateTimelineDoc';
import type { Template } from '../template/types';
import { planTimelineExportSegments } from './exportSegments';
import {
  talkMotionAt,
  TALK_BOB_PX,
  TALK_BOUNCE_END_SEC,
  TALK_BOUNCE_PX,
  TALK_BOUNCE_UP_SEC,
  TALK_EASE_SEC,
  TALK_PULSE_SCALE,
  TALK_WAVE_HZ,
} from './talkMotion';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TalkMotion, TimelineClip, TimelineProject } from './types';

const portrait = (talkMotion?: TalkMotion): TimelineClip =>
  ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.shape, trackId: 'track_001', startSec: 0, durationSec: 20, x: 0, y: 0, w: 100, h: 100, shapeType: 'rect', ...(talkMotion ? { talkMotion } : {}) }) as TimelineClip;
const voice = (id: string, startSec: number, durationSec: number, over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id, kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec, durationSec, voice: { text: 'あ', status: 'none' }, ...over }) as TimelineClip;
const doc = (clips: TimelineClip[], over: Partial<TimelineProject> = {}): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: 'proj_20261007_001',
  projectName: 't',
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600, creditDisplay: { mode: 'hidden' } },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [],
  tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }, { id: 'track_003', kind: TRACK_KIND.audio }],
  clips,
  ...over,
} as TimelineProject);

describe('talkMotionAt（ADR-0056）', () => {
  it('はねる＝声の頭で上がり（ゆっくり終わる）・戻る（ゆっくり始まる）・それ以外は動かない', () => {
    const p = portrait({ trackId: 'track_002', kind: 'bounce' });
    const d = doc([p, voice('clip_002', 2, 3)]);
    expect(talkMotionAt(d, p, 1.9)).toEqual({ dy: 0, scale: 1 }); // 声の前
    expect(talkMotionAt(d, p, 2 + TALK_BOUNCE_UP_SEC).dy).toBeCloseTo(-TALK_BOUNCE_PX, 9); // 頂点
    expect(talkMotionAt(d, p, 2 + TALK_BOUNCE_UP_SEC / 2).dy).toBeCloseTo(-TALK_BOUNCE_PX * 0.75, 9); // ゆっくり終わる＝半分で 3/4
    expect(talkMotionAt(d, p, 2 + TALK_BOUNCE_END_SEC).dy).toBeCloseTo(0, 6); // 戻りきる
    expect(talkMotionAt(d, p, 4)).toEqual({ dy: 0, scale: 1 }); // 喋っている途中でも1回きり
  });

  it('ゆらゆら・ふくらむ＝喋っている間だけ・入り抜けはなめらか・強さは倍率', () => {
    const quarter = 1 / (4 * TALK_WAVE_HZ); // |sin| が 1 になる所
    const bob = portrait({ trackId: 'track_002', kind: 'bob', strength: 2 });
    const d = doc([bob, voice('clip_002', 2, 3)]);
    expect(talkMotionAt(d, bob, 2 + quarter).dy).toBeCloseTo(-TALK_BOB_PX * 2, 9);
    expect(Math.abs(talkMotionAt(d, bob, 2 + TALK_EASE_SEC / 4).dy)).toBeLessThan(TALK_BOB_PX * 2 * 0.25 + 1e-9); // 入りは小さい
    expect(talkMotionAt(d, bob, 5.01)).toEqual({ dy: 0, scale: 1 }); // 終わったら止まる
    const pulse = portrait({ trackId: 'track_002', kind: 'pulse' });
    expect(talkMotionAt(doc([pulse, voice('clip_002', 2, 3)]), pulse, 2 + quarter)).toEqual({ dy: 0, scale: 1 + TALK_PULSE_SCALE });
  });

  it('結んだ列が無い・音の列でない・隠した列／部品・別の列の声では動かない', () => {
    const p = portrait({ trackId: 'track_002', kind: 'bounce' });
    const at = 2 + TALK_BOUNCE_UP_SEC;
    expect(talkMotionAt(doc([p, voice('clip_002', 2, 3, { trackId: 'track_003' })]), p, at).dy).toBe(0);
    expect(talkMotionAt(doc([p, voice('clip_002', 2, 3, { hidden: true })]), p, at).dy).toBe(0);
    const hiddenTrack = doc([p, voice('clip_002', 2, 3)], { tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio, hidden: true }] } as Partial<TimelineProject>);
    expect(talkMotionAt(hiddenTrack, p, at).dy).toBe(0);
    const toVisual = portrait({ trackId: 'track_001', kind: 'bounce' });
    expect(talkMotionAt(doc([toVisual, voice('clip_002', 2, 3, { trackId: 'track_001' })]), toVisual, at).dy).toBe(0);
  });

  it('同じ列の声が重なったら、先に始まったほうで数える（2倍にしない）', () => {
    const p = portrait({ trackId: 'track_002', kind: 'bounce' });
    const d = doc([p, voice('clip_002', 2, 3), voice('clip_003', 2 + TALK_BOUNCE_UP_SEC, 3)]);
    // 後から始まった声の頭（＝先の声ではもう戻りかけ）＝先の声の値
    expect(talkMotionAt(d, p, 2 + TALK_BOUNCE_UP_SEC).dy).toBeCloseTo(-TALK_BOUNCE_PX, 9);
    expect(talkMotionAt(d, p, 2 + TALK_BOUNCE_END_SEC).dy).toBeCloseTo(0, 6);
  });
});

describe('書き出しでは動く部品（ADR-0056 決定6）', () => {
  // #1376：動くのは結んだ声が鳴っている間だけ＝その区間だけ毎コマ、残りはそのまま流す。
  it('喋っている間の動きを持つ動画の部品は、声が鳴っている区間だけ毎コマ焼く', () => {
    const video = (talkMotion?: TalkMotion): TimelineClip =>
      ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_001', ...(talkMotion ? { talkMotion } : {}) }) as TimelineClip;
    const assets = [{ assetId: 'asset_001', assetType: 'video', displayName: 'v.mp4', filePath: 'assets/v.mp4' }];
    const kinds = (c: TimelineClip) => planTimelineExportSegments(doc([c, voice('clip_002', 2, 3)], { assets } as Partial<TimelineProject>)).map((s) => s.kind);
    expect(kinds(video())).toEqual(['video']);
    expect(kinds(video({ trackId: 'track_002', kind: 'bob' }))).toEqual(['video', 'frames', 'video']);
  });
});

describe('付ける・外す（setClipTalkMotion）と列を消したときの結び', () => {
  it('音の列とだけ結ぶ・強さは 0 より大きく 5 まで・null で外す', () => {
    const d = doc([portrait(), voice('clip_002', 2, 3)]);
    const r = setClipTalkMotion(d, 'clip_001', { trackId: 'track_002', kind: 'bob', strength: 1.5 });
    if (!r.ok) throw new Error('断られた');
    expect(r.doc.clips[0].talkMotion).toEqual({ trackId: 'track_002', kind: 'bob', strength: 1.5 });
    expect(setClipTalkMotion(d, 'clip_001', { trackId: 'track_001', kind: 'bob' }).ok).toBe(false); // 映像の列
    expect(setClipTalkMotion(d, 'clip_001', { trackId: 'track_002', kind: 'bob', strength: 0 }).ok).toBe(false);
    expect(setClipTalkMotion(d, 'clip_001', { trackId: 'track_002', kind: 'bob', strength: 6 }).ok).toBe(false);
    expect(setClipTalkMotion(d, 'clip_002', { trackId: 'track_002', kind: 'bob' }).ok).toBe(false); // 音の部品は動かない
    const off = setClipTalkMotion(r.doc, 'clip_001', null);
    if (!off.ok) throw new Error('断られた');
    expect(off.doc.clips[0].talkMotion).toBeUndefined();
  });

  it('結んでいた音の列を消すと、結びも外れる（同じ番号の新しい列で勝手に動かない）', () => {
    const d = doc([portrait({ trackId: 'track_002', kind: 'bounce' }), voice('clip_002', 2, 3)]);
    const r = removeTrack(d, 'track_002');
    if (!r.ok) throw new Error('断られた');
    expect(r.doc.clips.find((c) => c.id === 'clip_001')?.talkMotion).toBeUndefined();
    const other = removeTrack(d, 'track_003');
    if (!other.ok) throw new Error('断られた');
    expect(other.doc.clips.find((c) => c.id === 'clip_001')?.talkMotion).toEqual({ trackId: 'track_002', kind: 'bounce' });
  });
});

// PR #1370 レビュー：バラす・検証・貼り付けで、結びを黙って失くさない／行き先の無い結びを持ち込まない。
describe('バラす・検証・貼り付け（PR #1370 レビュー）', () => {
  const template = {
    schemaVersion: '1.0', templateId: 'tmpl_a', name: 'a', category: 'photo_intro', aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 },
    layers: [
      { id: 'title', type: 'text', textKey: 'title', x: 0, y: 0, w: 800, h: 100 },
      { id: 'sub', type: 'text', textKey: 'main', x: 0, y: 200, w: 800, h: 100 },
    ],
  } as unknown as Template;
  const tpl = (talkMotion: TalkMotion): TimelineClip =>
    ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, templateId: 'tmpl_a', trackId: 'track_001', startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080, texts: { title: 'あ', main: 'い' }, talkMotion }) as TimelineClip;

  it('はねる・ゆらゆらでバラすと、全部の部品へ結びを写す（同じ絵）', () => {
    const r = explodeTemplateClip(doc([tpl({ trackId: 'track_002', kind: 'bounce' }), voice('clip_002', 2, 3)]), 'clip_001', template);
    if (!r.ok) throw new Error('断られた');
    const pieces = r.doc.clips.filter((c) => c.kind !== TIMELINE_CLIP_KIND.voice);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((c) => c.talkMotion?.trackId === 'track_002' && c.talkMotion.kind === 'bounce')).toBe(true);
  });

  it('ふくらむはバラさない（部品ごとの中心でふくらむ＝別の絵）', () => {
    const r = explodeTemplateClip(doc([tpl({ trackId: 'track_002', kind: 'pulse' }), voice('clip_002', 2, 3)]), 'clip_001', template);
    expect(r).toEqual({ ok: false, reason: EDIT_BLOCKED.explodeTalkPulse });
  });

  it('声の列が無い・音の列でない結びは検証が知らせる（黙って動かなくしない）', () => {
    const codes = (tm: TalkMotion) => validateTimelineDoc(doc([portrait(tm)])).map((w) => w.code);
    expect(codes({ trackId: 'track_009', kind: 'bob' })).toContain('TIMELINE_TALK_MOTION_TRACK_NOT_FOUND');
    expect(codes({ trackId: 'track_001', kind: 'bob' })).toContain('TIMELINE_TALK_MOTION_TRACK_NOT_FOUND');
    expect(codes({ trackId: 'track_002', kind: 'bob' })).not.toContain('TIMELINE_TALK_MOTION_TRACK_NOT_FOUND');
  });

  it('貼り付け先に声の列が無ければ、結びを持ち込まない（ある列なら残す）', () => {
    const src = portrait({ trackId: 'track_002', kind: 'bob' });
    const gone = doc([], { tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }] } as Partial<TimelineProject>);
    const r1 = pasteClips(gone, [src], 30);
    if (!r1.ok) throw new Error('断られた');
    expect(r1.doc.clips[0].talkMotion).toBeUndefined();
    const r2 = pasteClips(doc([]), [src], 30);
    if (!r2.ok) throw new Error('断られた');
    expect(r2.doc.clips[0].talkMotion).toEqual({ trackId: 'track_002', kind: 'bob' });
  });
});

