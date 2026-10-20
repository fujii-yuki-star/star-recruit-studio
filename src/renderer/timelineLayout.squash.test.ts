// 縦横の倍率が効いた部品の**キャンバスの枠**（#1475・ADR-0059 段階2）。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../domain/timeline/types';
import type { TimelineClip, TimelineProject } from '../domain/timeline/types';
import { baseBoxPatchFromShown, clipWarpOf, drawnMirrorOf, squashedBox, timelineCanvasClipsAt, unsquashedBox } from './timelineLayout';
import type { Box } from './timelineLayout';

/** 回した長方形の4隅（キャンバスの座標）。 */
function cornersOf(b: Box): [number, number][] {
  const r = ((b.rotation ?? 0) * Math.PI) / 180;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => {
    const vx = (sx * b.w) / 2;
    const vy = (sy * b.h) / 2;
    return [cx + vx * Math.cos(r) - vy * Math.sin(r), cy + vx * Math.sin(r) + vy * Math.cos(r)];
  });
}

const sortPts = (ps: [number, number][]): string[] => ps.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).sort();

// ⚠️ **期待値は描画の側から作る**＝枠の4隅が、描画が部品に当てる行列（`clipWarpOf`）で写した4隅と同じ点の集まりであること。
//   式を写した検査にしない（同じ書き違いを両方に入れると緑になる）。
describe('squashedBox（見えている長方形）', () => {
  const cases: { name: string; box: Box; sx: number; sy: number; pivot?: { x: number; y: number } }[] = [
    { name: '中心まわり・横だけ', box: { x: 100, y: 50, w: 400, h: 200 }, sx: 1.5, sy: 1 },
    { name: '足元を支点・縦だけ', box: { x: 100, y: 50, w: 400, h: 200 }, sx: 1, sy: 0.5, pivot: { x: 0.5, y: 1 } },
    { name: '回した箱・端の支点', box: { x: 300, y: 200, w: 300, h: 120, rotation: 30 }, sx: 0.7, sy: 1.8, pivot: { x: 0, y: 0.25 } },
    { name: '負の倍率（向きを裏返す）', box: { x: 0, y: 0, w: 200, h: 100, rotation: -45 }, sx: -1.2, sy: 0.9, pivot: { x: 0.9, y: 0.1 } },
  ];
  it.each(cases)('$name：描画の行列で写した4隅と同じ', ({ box, sx, sy, pivot }) => {
    const warp = clipWarpOf({ id: 'c', ...(pivot ? { pivot } : {}) }, box, { sx, sy })!.matrix;
    const [a, b, c, d, e, f] = warp;
    const drawn = cornersOf(box).map(([x, y]) => [a * x + c * y + e, b * x + d * y + f] as [number, number]);
    expect(sortPts(cornersOf(squashedBox(box, { sx, sy }, pivot)))).toEqual(sortPts(drawn));
  });

  it.each(cases)('$name：戻すと元の箱', ({ box, sx, sy, pivot }) => {
    const back = unsquashedBox(squashedBox(box, { sx, sy }, pivot), { sx, sy }, pivot);
    expect(back.x).toBeCloseTo(box.x, 9);
    expect(back.y).toBeCloseTo(box.y, 9);
    expect(back.w).toBeCloseTo(box.w, 9);
    expect(back.h).toBeCloseTo(box.h, 9);
  });

  it('倍率が無ければ同じ箱をそのまま返す（既存の枠を1つも動かさない）', () => {
    const box = { x: 1, y: 2, w: 3, h: 4 };
    expect(squashedBox(box, {})).toBe(box);
    expect(squashedBox(box, { sx: 1, sy: 1 })).toBe(box);
  });
});

describe('baseBoxPatchFromShown（縦横の倍率を外して素の箱へ）', () => {
  const box: Box = { x: 100, y: 100, w: 400, h: 200 };
  const cc = { box, finalBox: box, ownTr: { scaleX: 2, scaleY: 0.5 }, clip: { pivot: { x: 0, y: 0 } } };
  const shown = squashedBox(box, { sx: 2, sy: 0.5 }, { x: 0, y: 0 });

  it('動かした量はそのまま素の箱の移動になる（伸ばし方に関係なく）', () => {
    const p = baseBoxPatchFromShown(cc, { x: shown.x + 30, y: shown.y - 10 });
    expect(p.x).toBeCloseTo(box.x + 30, 9);
    expect(p.y).toBeCloseTo(box.y - 10, 9);
    expect(p.w).toBeUndefined(); // 動かすだけでは大きさを書かない
  });

  it('枠の大きさを変えると、倍率で割った大きさが素の箱へ入る', () => {
    const p = baseBoxPatchFromShown(cc, { x: shown.x, y: shown.y, w: shown.w + 100, h: shown.h });
    expect(p.w).toBeCloseTo((shown.w + 100) / 2, 9);
    expect(p.h).toBeCloseTo(box.h, 9);
    // 支点（左上）を動かしていないので、素の箱の左上も動かない。
    expect(p.x).toBeCloseTo(box.x, 9);
    expect(p.y).toBeCloseTo(box.y, 9);
  });

  it('倍率が無い部品は今までと同じ（返ってきた値をそのまま使う）', () => {
    const plain = { box, finalBox: box, ownTr: {} };
    expect(baseBoxPatchFromShown(plain, { x: 150, y: 120 })).toEqual({ x: 150, y: 120 });
  });
});

describe('timelineCanvasClipsAt の枠（shownBox）', () => {
  const doc = (): TimelineProject => ({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20261020_001',
    projectName: 't',
    createdAt: '',
    updatedAt: '',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 10, maxDurationSec: 60 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips: [{
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.shape, trackId: 'track_001', startSec: 0, durationSec: 4,
      x: 100, y: 100, w: 400, h: 200, shapeType: 'rect',
    } as TimelineClip],
    animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, scaleX: 2 }, { timeSec: 4, scaleX: 2 }] }],
  });

  it('縦横の倍率が効いている間は、伸ばした長方形を枠にする', () => {
    const [cc] = timelineCanvasClipsAt(doc(), 1);
    expect(cc!.finalBox.w).toBe(400);
    expect(cc!.shownBox).toMatchObject({ x: -100, y: 100, w: 800, h: 200 }); // 中心まわりに横2倍
  });

  it('倍率が無ければ枠は描かれている箱と同じ', () => {
    const d = { ...doc(), animations: [] };
    const [cc] = timelineCanvasClipsAt(d, 1);
    expect(cc!.shownBox).toEqual(cc!.finalBox);
  });
});

describe('drawnMirrorOf（直している間の向き）', () => {
  it('反転だけ・負の倍率だけ・両方（裏の裏で元へ戻る）', () => {
    expect(drawnMirrorOf({ clip: { flipX: true }, ownTr: {} })).toEqual({ x: true, y: false });
    expect(drawnMirrorOf({ clip: {}, ownTr: { scaleY: -1 } })).toEqual({ x: false, y: true });
    expect(drawnMirrorOf({ clip: { flipX: true }, ownTr: { scaleX: -2 } })).toEqual({ x: false, y: false });
    expect(drawnMirrorOf({ clip: {}, ownTr: { scaleX: 2 } })).toEqual({ x: false, y: false });
  });
});
