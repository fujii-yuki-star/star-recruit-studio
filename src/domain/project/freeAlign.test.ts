import { describe, expect, it } from 'vitest';
import type { FreeElement } from './types';
import { alignFreeElements, distributeFreeElements, FREE_ALIGN, FREE_DISTRIBUTE } from './freeAlign';

// 整列・分布は applyFreeElementPositions に渡す移動量 {id,x,y}[] を返す純粋関数（#205・§7 テスト対象）。
const el = (id: string, x: number, y: number, w = 100, h = 50): FreeElement => ({
  id, kind: 'shape', x, y, w, h, zIndex: 1, shapeType: 'rect', fillColor: '#000',
});

describe('alignFreeElements', () => {
  // 外接矩形: left=10, right=400(=300+100), top=20, bottom=230(=180+50), centerX=205, centerY=125。
  const layout: FreeElement[] = [
    el('free_001', 10, 20),   // 左上
    el('free_002', 300, 180), // 右下
    el('free_003', 100, 100), // 中
  ];
  const ids = ['free_001', 'free_002', 'free_003'];
  const byId = (moves: { id: string; x: number; y: number }[]) =>
    Object.fromEntries(moves.map((m) => [m.id, m]));

  it('左そろえ：全要素の x を外接矩形の左端(10)に。y は不変', () => {
    const m = byId(alignFreeElements(layout, ids, FREE_ALIGN.left));
    expect(m.free_001).toMatchObject({ x: 10, y: 20 });
    expect(m.free_002).toMatchObject({ x: 10, y: 180 });
    expect(m.free_003).toMatchObject({ x: 10, y: 100 });
  });

  it('右そろえ：右端(400)に各要素の右辺を合わせる（x = 400 - w）', () => {
    const m = byId(alignFreeElements(layout, ids, FREE_ALIGN.right));
    expect(m.free_001.x).toBe(300); // 400 - 100
    expect(m.free_002.x).toBe(300);
  });

  it('左右中央：中心X(205)に各要素の中心を合わせる（x = 205 - w/2 = 155）', () => {
    const m = byId(alignFreeElements(layout, ids, FREE_ALIGN.centerX));
    expect(m.free_001.x).toBe(155);
    expect(m.free_003.x).toBe(155);
  });

  it('上そろえ／下そろえ／上下中央：y を外接矩形基準で合わせる', () => {
    expect(byId(alignFreeElements(layout, ids, FREE_ALIGN.top)).free_002.y).toBe(20);
    expect(byId(alignFreeElements(layout, ids, FREE_ALIGN.bottom)).free_001.y).toBe(180); // 230 - 50
    expect(byId(alignFreeElements(layout, ids, FREE_ALIGN.centerY)).free_001.y).toBe(100); // 125 - 25
  });

  it('2件未満は空（整列対象なし）', () => {
    expect(alignFreeElements(layout, ['free_001'], FREE_ALIGN.left)).toEqual([]);
    expect(alignFreeElements(layout, [], FREE_ALIGN.left)).toEqual([]);
  });
});

describe('distributeFreeElements', () => {
  // 横分布：中心 x が 50 / 350 / 600 の3要素（w=100）。両端固定、中間の中心を等間隔(50,325,600)に。
  const layout: FreeElement[] = [
    el('a', 0, 0),    // 中心x=50
    el('b', 300, 0),  // 中心x=350
    el('c', 550, 0),  // 中心x=600
  ];
  const ids = ['a', 'b', 'c'];

  it('横に等間隔：両端は固定、中間の中心を (first+last)/2 に', () => {
    const moves = distributeFreeElements(layout, ids, FREE_DISTRIBUTE.horizontal);
    const m = Object.fromEntries(moves.map((x) => [x.id, x]));
    expect(m.a.x).toBe(0);   // 端は不変（中心50 → x=0）
    expect(m.c.x).toBe(550); // 端は不変（中心600 → x=550）
    expect(m.b.x).toBe(275); // 中心 (50+600)/2=325 → x=325-50=275
  });

  it('縦に等間隔：y を中心基準で等間隔に', () => {
    const tall: FreeElement[] = [el('a', 0, 0, 100, 100), el('b', 0, 90, 100, 100), el('c', 0, 400, 100, 100)];
    const moves = distributeFreeElements(tall, ['a', 'b', 'c'], FREE_DISTRIBUTE.vertical);
    const m = Object.fromEntries(moves.map((x) => [x.id, x]));
    // 中心y: a=50, c=450 → 中間 b の中心=250 → y=250-50=200。
    expect(m.b.y).toBe(200);
    expect(m.a.y).toBe(0);
    expect(m.c.y).toBe(400);
  });

  it('3件未満は空（分布の意味なし）', () => {
    expect(distributeFreeElements(layout, ['a', 'b'], FREE_DISTRIBUTE.horizontal)).toEqual([]);
  });

  it('全要素が同一位置なら step=0 で位置は変わらない（NaN を出さない）', () => {
    const same: FreeElement[] = [el('a', 0, 0), el('b', 0, 0), el('c', 0, 0)];
    const moves = distributeFreeElements(same, ['a', 'b', 'c'], FREE_DISTRIBUTE.horizontal);
    expect(moves.every((m) => m.x === 0 && m.y === 0)).toBe(true);
  });
});
