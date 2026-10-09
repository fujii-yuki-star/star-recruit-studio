// 部品の動きの支点と反転（ADR-0059・#1186）。描画の核（支点まわりの拡縮・回転／反転のゆがみ／SVG のくるみ）と、
// キャンバスで掴んだときの逆算・書き出しの倒し方を固定する。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../domain/enums';
import type { TimelineClip, TimelineProject } from '../domain/timeline/types';
import { TIMELINE_SCHEMA_VERSION } from '../domain/timeline/types';
import { applyInterpolatedTransform, type TransformableRect } from './layout';
import { layoutToSvg } from './sceneSvg';
import { baseBoxPatchFromShown, clipWarpOf, layoutTimelineAt, timelineCanvasClipsAt } from './timelineLayout';

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
const box = (over: Partial<TransformableRect> = {}): TransformableRect => ({ x: 0, y: 0, w: 100, h: 200, rotation: 0, ...over });

describe('applyInterpolatedTransform の支点（ADR-0059 決定1）', () => {
  it('支点が中心（未指定・0.5/0.5）なら今までと同じ値', () => {
    const tr = { scale: 1.5, x: 7, y: -3, rotation: 30 };
    const a = box({ x: 10, y: 20, rotation: 15 });
    const b = box({ x: 10, y: 20, rotation: 15 });
    applyInterpolatedTransform(a, tr);
    applyInterpolatedTransform(b, tr, { x: 0.5, y: 0.5 });
    expect(b).toEqual(a);
  });

  it('足元を支点に 90 度回すと、足元は動かず中心が足元のまわりを回る', () => {
    const b = box();
    applyInterpolatedTransform(b, { rotation: 90 }, { x: 0.5, y: 1 });
    // 足元 (50,200)・中心 (50,100) → 時計回りに 90 度で中心は (150,200)。
    expect(near(b.x + b.w / 2, 150) && near(b.y + b.h / 2, 200)).toBe(true);
    expect(b.rotation).toBe(90);
  });

  it('足元を支点に縮めると、足元（下の辺）は動かない', () => {
    const b = box();
    applyInterpolatedTransform(b, { scale: 0.5 }, { x: 0.5, y: 1 });
    expect([b.x, b.y, b.w, b.h]).toEqual([25, 100, 50, 100]);
  });

  it('支点は素の箱の向きで測る（回した部品の足元は、回った先の足元）', () => {
    // 素の箱を 90 度回すと、足元は中心の左（-100, 0）。そこを支点に 90 度回すと中心は (-50, 0) の向こう側へ。
    const b = box({ rotation: 90 });
    applyInterpolatedTransform(b, { rotation: 90 }, { x: 0.5, y: 1 });
    // 支点 P＝(50,100)+(-100,0)＝(-50,100)。中心 C＝(50,100)。C−P＝(100,0) を 90 度回す＝(0,100) → 中心は (-50,200)。
    expect(near(b.x + b.w / 2, -50) && near(b.y + b.h / 2, 200)).toBe(true);
    expect(b.rotation).toBe(180);
  });

  it('回した部品を足元を支点に縮めると、回った先の足元が動かない', () => {
    // 素の箱を 90 度回すと、足元は中心 (50,100) の左 (−50,100)。そこを支点に半分へ縮めると中心は (0,100) へ寄る。
    const b = box({ rotation: 90 });
    applyInterpolatedTransform(b, { scale: 0.5 }, { x: 0.5, y: 1 });
    expect(near(b.x + b.w / 2, 0) && near(b.y + b.h / 2, 100)).toBe(true);
    expect([b.w, b.h]).toEqual([50, 100]);
  });

  it('支点を外しても、回さない・縮めない動きは平行移動だけ', () => {
    const b = box();
    applyInterpolatedTransform(b, { x: 5, y: 6, rotation: 0 }, { x: 0, y: 0 });
    expect([b.x, b.y, b.w, b.h, b.rotation]).toEqual([5, 6, 100, 200, 0]);
  });
});

describe('baseBoxPatchFromShown の支点（キャンバスで掴んだときの逆算）', () => {
  it('描かれた箱を動かした量が、素の箱の平行移動になる（支点を外して回っていても）', () => {
    const base = { x: 30, y: 40, w: 100, h: 200, rotation: 10 };
    const ownTr = { scale: 0.8, x: 12, y: -7, rotation: 25 };
    const pivot = { x: 0.5, y: 1 };
    const shown = { ...base };
    applyInterpolatedTransform(shown, ownTr, pivot);
    // 描かれた箱を (+15, −9) 動かした → 素の箱も (+15, −9)。
    const out = baseBoxPatchFromShown({ box: base, ownTr, clip: { pivot } }, { x: shown.x + 15, y: shown.y - 9 });
    expect(near(out.x!, base.x + 15) && near(out.y!, base.y - 9)).toBe(true);
  });

  it('支点が中心なら、今までの式（中心まわり）と同じ値', () => {
    const base = { x: 30, y: 40, w: 100, h: 200, rotation: 0 };
    const ownTr = { scale: 2, x: 5, y: 6 };
    const out = baseBoxPatchFromShown({ box: base, ownTr }, { x: 100, y: 50 });
    expect(out).toEqual({ x: 100 - 5 + (100 * 2 - 100) / 2, y: 50 - 6 + (200 * 2 - 200) / 2 });
  });
});

describe('clipWarpOf（反転の行列・ADR-0059 決定2）', () => {
  const b = { x: 100, y: 50, w: 200, h: 100 };
  it('反転しなければ持たない（従来の出力を変えない）', () => {
    expect(clipWarpOf({ id: 'clip_001' }, b)).toBeUndefined();
    expect(clipWarpOf({ id: 'clip_001', flipX: false, flipY: false }, b)).toBeUndefined();
  });
  it('左右反転＝箱の中心（200）の縦線で鏡に映す', () => {
    expect(clipWarpOf({ id: 'clip_001', flipX: true }, b)!.matrix).toEqual([-1, 0, 0, 1, 400, 0]);
  });
  it('上下反転＝箱の中心（100）の横線で鏡に映す', () => {
    expect(clipWarpOf({ id: 'clip_001', flipY: true }, b)!.matrix).toEqual([1, 0, 0, -1, 0, 200]);
  });
  it('箱が 90 度回っていれば、部品の左右は画面の上下＝左右反転は画面では上下に映す', () => {
    const m = clipWarpOf({ id: 'clip_001', flipX: true }, { ...b, rotation: 90 })!.matrix;
    [1, 0, 0, -1, 0, 200].forEach((v, i) => expect(near(m[i], v)).toBe(true));
  });
});

function doc(clips: TimelineClip[], animations: TimelineProject['animations'] = []): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: 'proj_20261009_001', projectName: 't',
    createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' }, assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips, animations,
  } as TimelineProject;
}
const shape = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.shape, trackId: 'track_001', startSec: 0, durationSec: 5, x: 100, y: 100, w: 200, h: 100, shapeType: 'rect', fillColor: '#ff0000', ...over }) as TimelineClip;
const opts = { templateOf: () => undefined };

describe('clipWarpOf の縦横別々の大きさ（ADR-0059 段階2）', () => {
  const b = { x: 0, y: 0, w: 100, h: 50 };
  it('動きの支点まわりに縦横を変える（足元を支点に縦に潰すと、足元は動かない）', () => {
    const m = clipWarpOf({ id: 'clip_001', pivot: { x: 0.5, y: 1 } }, b, { sx: 1, sy: 0.5 })!.matrix;
    // 足元 (50,50) は動かない＝y' = 0.5·y + f で 50 → 50（f = 25）。
    expect(m).toEqual([1, 0, 0, 0.5, 0, 25]);
  });
  it('支点が無ければ中心まわり', () => {
    expect(clipWarpOf({ id: 'clip_001' }, b, { sx: 2, sy: 1 })!.matrix).toEqual([2, 0, 0, 1, -50, 0]);
  });
  it('反転と合わせると「反転してから縦横を変える」（中心は動かない）', () => {
    const m = clipWarpOf({ id: 'clip_001', flipX: true }, b, { sx: 0.5, sy: 1 })!.matrix;
    // 中心 (50,25) は動かない・横は −0.5 倍。
    expect([m[0], m[3]]).toEqual([-0.5, 1]);
    expect(near(m[0] * 50 + m[2] * 25 + m[4], 50) && near(m[1] * 50 + m[3] * 25 + m[5], 25)).toBe(true);
  });
  it('縦横とも 1 で反転も無ければ持たない', () => {
    expect(clipWarpOf({ id: 'clip_001' }, b, { sx: 1, sy: 1 })).toBeUndefined();
  });
});

describe('layoutTimelineAt と SVG（描画の核は1つ・ADR-0001）', () => {
  it('反転した部品は、その部品の中身だけを <g transform="matrix(…)"> で包む', () => {
    const layout = layoutTimelineAt(doc([shape({ flipX: true })]), 1, opts);
    expect(layout.items.every((i) => i.warp?.key === 'warp_clip_001')).toBe(true);
    expect(layoutToSvg(layout)).toContain('<g transform="matrix(-1 0 0 1 400 0)">');
  });

  it('キーフレームの横だけの倍率は、その部品のゆがみになる', () => {
    const anim = [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, scaleX: 0.5 }] }];
    const layout = layoutTimelineAt(doc([shape()], anim), 1, opts);
    // 箱 (100,100,200,100) の中心 (200,150) まわりに横 0.5。
    expect(layout.items[0].warp?.matrix).toEqual([0.5, 0, 0, 1, 100, 0]);
  });

  it('反転しない部品は包まない（既に作った動画の絵を変えない）', () => {
    const layout = layoutTimelineAt(doc([shape()]), 1, opts);
    expect(layout.items.some((i) => i.warp != null)).toBe(false);
    expect(layoutToSvg(layout)).not.toContain('matrix(');
  });

  it('動きの支点は、描かれる箱（キャンバスの枠と描画が見るもの）に効く', () => {
    const anim = [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, rotation: 90 }] }];
    const centered = timelineCanvasClipsAt(doc([shape()], anim), 1)[0].finalBox;
    const footed = timelineCanvasClipsAt(doc([shape({ pivot: { x: 0.5, y: 1 } })], anim), 1)[0].finalBox;
    // 中心まわりなら中心は動かない（200,150）。足元（200,200）まわりなら中心は (250,200) へ。
    expect([centered.x + centered.w / 2, centered.y + centered.h / 2]).toEqual([200, 150]);
    expect(near(footed.x + footed.w / 2, 250) && near(footed.y + footed.h / 2, 200)).toBe(true);
  });
});
