// タイムライン形式の動画を、別の縦横比の版として写す（ADR-0057・#1386）。規則ごとに1本ずつ。
import { describe, expect, it } from 'vitest';
import { FREE_ELEMENT_KIND, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { DEFAULT_FONT_SIZE } from '../template/textStyle';
import type { Template } from '../template/types';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import { flippedOrientation, reorientTimelineDoc } from './reorient';

const S = 1080 / 1920; // 16:9 → 9:16 の縮める倍率

function doc(clips: TimelineClip[], over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: 'proj_20261008_301', projectName: '横',
    createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips,
    ...over,
  };
}
const part = (id: string, kind: TimelineClip['kind'], over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id, kind, trackId: 'track_001', startSec: 0, durationSec: 5, ...over }) as TimelineClip;
const tpl = (templateId: string, category: string, aspectRatio: '16:9' | '9:16', layers: Template['layers']): Template =>
  ({ schemaVersion: '1.0', templateId, name: templateId, category, aspectRatio, canvas: aspectRatio === '16:9' ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 }, layers }) as Template;

describe('reorientTimelineDoc', () => {
  it('向きを入れ替え、元の文書は変えない', () => {
    const d = doc([]);
    const r = reorientTimelineDoc(d, '9:16', []);
    expect(r.doc.videoSettings.aspectRatio).toBe('9:16');
    expect(d.videoSettings.aspectRatio).toBe('16:9');
  });

  it('画面いっぱいの部品は、新しい画面いっぱい（箱を書いていないものはそのまま）', () => {
    const r = reorientTimelineDoc(doc([
      part('clip_001', FREE_ELEMENT_KIND.slot, { x: 0, y: 0, w: 1920, h: 1080, assetId: 'a' }),
      part('clip_002', FREE_ELEMENT_KIND.shape),
    ]), '9:16', []);
    expect(r.doc.clips[0]).toMatchObject({ x: 0, y: 0, w: 1080, h: 1920 });
    expect(r.doc.clips[1].w).toBeUndefined();
  });

  it('字幕は相対の位置と幅で写し、文字の大きさと高さは変えない', () => {
    const r = reorientTimelineDoc(doc([part('clip_001', FREE_ELEMENT_KIND.subtitle, { x: 192, y: 900, w: 1536, h: 120, fontSize: 48 })]), '9:16', []);
    const c = r.doc.clips[0];
    expect(c.x).toBeCloseTo(108);
    expect(c.w).toBeCloseTo(864);
    expect(c.y).toBeCloseTo(1600);
    expect(c).toMatchObject({ h: 120, fontSize: 48 });
  });

  it('その他の部品は旧画面を収まるように縮めて中央へ（中身も同じ倍率）', () => {
    const r = reorientTimelineDoc(doc([part('clip_001', FREE_ELEMENT_KIND.text, { x: 960, y: 540, w: 400, h: 200, text: 'あ', strokeWidth: 4 })]), '9:16', []);
    const c = r.doc.clips[0];
    // 中心 (1160, 640) → ((1160−960)·S+540, (640−540)·S+960)
    expect(c.x! + c.w! / 2).toBeCloseTo(200 * S + 540);
    expect(c.y! + c.h! / 2).toBeCloseTo(100 * S + 960);
    expect(c.w).toBeCloseTo(400 * S);
    expect(c.fontSize).toBeCloseTo(DEFAULT_FONT_SIZE * S);
    expect(c.strokeWidth).toBeCloseTo(4 * S);
  });

  it('縦→横でも新しい画面の中央へ（横の中心は 960）', () => {
    // ⚠️ 横→縦だけだと、横の中央寄せは左上基準と同じ値になる（960·S＝540）＝見分けられない。
    const d = doc([part('clip_001', FREE_ELEMENT_KIND.text, { x: 440, y: 860, w: 200, h: 200, text: 'あ' })], {
      videoSettings: { aspectRatio: '9:16', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    });
    const c = reorientTimelineDoc(d, '16:9', []).doc.clips[0];
    // 中心 (540, 960) は旧画面の中心 → 新画面の中心 (960, 540)。
    expect(c.x! + c.w! / 2).toBeCloseTo(960);
    expect(c.y! + c.h! / 2).toBeCloseTo(540);
  });

  it('図形の角丸も同じ倍率（文字の大きさは付けない）', () => {
    const r = reorientTimelineDoc(doc([part('clip_001', FREE_ELEMENT_KIND.shape, { x: 0, y: 0, w: 400, h: 400, radius: 40 })]), '9:16', []);
    expect(r.doc.clips[0].radius).toBeCloseTo(40 * S);
    expect(r.doc.clips[0].fontSize).toBeUndefined();
  });

  it('動きのずれは、その部品に当てた倍率で掛ける（大きさ・回転はそのまま）／まとまりは縮めた倍率', () => {
    const d = doc([
      part('clip_001', FREE_ELEMENT_KIND.text, { x: 0, y: 0, w: 100, h: 100, text: 'あ' }),
      part('clip_002', FREE_ELEMENT_KIND.subtitle, { x: 0, y: 900, w: 1920, h: 100 }),
    ], {
      groups: [{ id: 'group_001', members: ['clip_001'], transform: { x: 100, y: 50, rotation: 0, scale: 1 } }],
      animations: [
        { id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, x: 100, y: 100, scale: 2, rotation: 30 }] },
        { id: 'anim_002', targetId: 'clip_002', keyframes: [{ timeSec: 0, x: 192, y: 108 }] },
        { id: 'anim_003', targetId: 'group_001', keyframes: [{ timeSec: 0, x: 100 }] },
      ],
    });
    const r = reorientTimelineDoc(d, '9:16', []);
    const kf = (id: string) => r.doc.animations!.find((a) => a.id === id)!.keyframes[0];
    expect(kf('anim_001')).toMatchObject({ x: 100 * S, y: 100 * S, scale: 2, rotation: 30 });
    expect(kf('anim_002').x).toBeCloseTo(108);
    expect(kf('anim_002').y).toBeCloseTo(192);
    expect(kf('anim_003').x).toBeCloseTo(100 * S);
    expect(r.doc.groups![0].transform).toMatchObject({ x: 100 * S, y: 50 * S, scale: 1 });
  });

  it('見た目パターンは同じ種類の別の向きへ・合う見た目が無い／無い層は数える（中身は残す）', () => {
    const templates = [
      tpl('photo_h', 'photo_intro', '16:9', [{ id: 'mainVisual', type: 'slot', x: 0, y: 0, w: 1, h: 1 }, { id: 'logo', type: 'logo', x: 0, y: 0, w: 1, h: 1 }]),
      tpl('photo_v', 'photo_intro', '9:16', [{ id: 'mainVisual', type: 'slot', x: 0, y: 0, w: 1, h: 1 }]),
      tpl('chapter_h', 'chapter', '16:9', []),
    ];
    const r = reorientTimelineDoc(doc([
      part('clip_001', TIMELINE_CLIP_KIND.template, { templateId: 'photo_h', assetRefs: { mainVisual: 'a', logo: 'b' } }),
      part('clip_002', TIMELINE_CLIP_KIND.template, { templateId: 'chapter_h' }),
    ]), '9:16', templates);
    expect(r.doc.clips[0].templateId).toBe('photo_v');
    expect(r.doc.clips[0].assetRefs).toEqual({ mainVisual: 'a', logo: 'b' });
    expect(r.layersUnmatched).toBe(1);
    expect(r.doc.clips[1].templateId).toBe('chapter_h');
    expect(r.templateUnmatched).toBe(1);
  });

  it('空の差し込み口は数えない・すでに新しい向きの見た目は替えない・見つからない見た目は数えない', () => {
    const templates = [
      tpl('photo_h', 'photo_intro', '16:9', [{ id: 'mainVisual', type: 'slot', x: 0, y: 0, w: 1, h: 1 }, { id: 'sub', type: 'slot', x: 0, y: 0, w: 1, h: 1 }]),
      tpl('photo_v', 'photo_intro', '9:16', [{ id: 'mainVisual', type: 'slot', x: 0, y: 0, w: 1, h: 1 }]),
      tpl('photo_v2', 'photo_intro', '9:16', [{ id: 'mainVisual', type: 'slot', x: 0, y: 0, w: 1, h: 1 }]),
    ];
    const r = reorientTimelineDoc(doc([
      part('clip_001', TIMELINE_CLIP_KIND.template, { templateId: 'photo_h', assetRefs: { mainVisual: 'a', sub: null } as never }),
      part('clip_002', TIMELINE_CLIP_KIND.template, { templateId: 'photo_v2' }),
      part('clip_003', TIMELINE_CLIP_KIND.template, { templateId: 'gone' }),
    ]), '9:16', templates);
    expect(r.layersUnmatched).toBe(0);
    expect(r.doc.clips[1].templateId).toBe('photo_v2');
    expect(r.doc.clips[2].templateId).toBe('gone');
    expect(r.templateUnmatched).toBe(0);
  });

  it('縦→横で下寄りの字幕は、高さを保ったまま画面の中へ収める', () => {
    const d = doc([part('clip_001', FREE_ELEMENT_KIND.subtitle, { x: 0, y: 1750, w: 1080, h: 150 })], {
      videoSettings: { aspectRatio: '9:16', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    });
    const r = reorientTimelineDoc(d, '16:9', []);
    expect(r.doc.clips[0]).toMatchObject({ y: 1080 - 150, h: 150 });
    expect(r.outside).toBe(0);
  });

  it('はみ出した部品を数える（元から画面の外へ出ていた部品は、縮めても外に残る）', () => {
    expect(reorientTimelineDoc(doc([part('clip_001', FREE_ELEMENT_KIND.text, { x: -400, y: 10, w: 300, h: 100, text: 'あ' })]), '9:16', []).outside).toBe(1);
    expect(reorientTimelineDoc(doc([part('clip_001', FREE_ELEMENT_KIND.text, { x: 10, y: 10, w: 100, h: 100, text: 'あ' })]), '9:16', []).outside).toBe(0);
  });

  it('音・読み上げは位置を持たないので触らない', () => {
    const voice = { id: 'clip_009', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 2, voice: { text: 'あ', status: 'none' } } as TimelineClip;
    expect(reorientTimelineDoc(doc([voice]), '9:16', []).doc.clips[0]).toBe(voice);
  });

  it('flippedOrientation', () => {
    expect(flippedOrientation('16:9')).toBe('9:16');
    expect(flippedOrientation('9:16')).toBe('16:9');
  });
});
