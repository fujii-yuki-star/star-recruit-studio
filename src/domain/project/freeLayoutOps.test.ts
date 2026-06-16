import { describe, expect, it } from 'vitest';
import type { FreeElement } from './types';
import {
  addFreeElement, createFreeElement, moveFreeElement, removeFreeElement, resizeFreeElement, updateFreeElement,
} from './freeLayoutOps';

describe('createFreeElement / addFreeElement', () => {
  it('空配列に slot を追加：id=free_001・zIndex=1・kind 既定（assetId=null/fit あり）', () => {
    const next = addFreeElement([], 'slot');
    expect(next).toHaveLength(1);
    const el = next[0];
    expect(el.id).toBe('free_001');
    expect(el.kind).toBe('slot');
    expect(el.zIndex).toBe(1); // 背景(0)より前面
    expect(el.assetId).toBeNull();
    expect(el.fit).toBe('cover');
    expect(el.w).toBeGreaterThan(0);
    expect(el.h).toBeGreaterThan(0);
  });

  it('text/shape の既定値（text は文字・fontSize、shape は shapeType・fillColor）', () => {
    const text = createFreeElement([], 'text');
    expect(text.kind).toBe('text');
    expect(text.text).toBeTruthy();
    expect(text.fontSize).toBeGreaterThan(0);
    expect(text.fontWeight).toBe('normal');

    const shape = createFreeElement([], 'shape');
    expect(shape.kind).toBe('shape');
    expect(shape.shapeType).toBe('rect');
    expect(shape.fillColor).toBeTruthy();
  });

  it('追加のたびに id が連番・zIndex が最前面+1 になる', () => {
    let layout: FreeElement[] = [];
    layout = addFreeElement(layout, 'shape'); // free_001 z=1
    layout = addFreeElement(layout, 'text'); // free_002 z=2
    layout = addFreeElement(layout, 'slot'); // free_003 z=3
    expect(layout.map((e) => e.id)).toEqual(['free_001', 'free_002', 'free_003']);
    expect(layout.map((e) => e.zIndex)).toEqual([1, 2, 3]);
  });

  it('既存の最大 zIndex を踏まえて最前面に積む', () => {
    const existing: FreeElement[] = [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 50 }];
    const next = addFreeElement(existing, 'text');
    expect(next[1].zIndex).toBe(51);
  });
});

describe('updateFreeElement', () => {
  const layout: FreeElement[] = [
    { id: 'free_001', kind: 'shape', x: 0, y: 0, w: 100, h: 100, zIndex: 1, fillColor: '#000000' },
    { id: 'free_002', kind: 'text', x: 0, y: 0, w: 100, h: 100, zIndex: 2, text: 'a' },
  ];

  it('指定 id の要素だけに patch を当て、他は不変（参照維持）', () => {
    const next = updateFreeElement(layout, 'free_001', { x: 500, w: 300 });
    expect(next[0]).toMatchObject({ id: 'free_001', x: 500, w: 300 });
    expect(next[1]).toBe(layout[1]); // 非対象は同一参照
  });

  it('存在しない id は変化なし', () => {
    const next = updateFreeElement(layout, 'free_999', { x: 1 });
    expect(next).toEqual(layout);
  });
});

describe('removeFreeElement', () => {
  it('指定 id の要素を取り除く', () => {
    const layout: FreeElement[] = [
      { id: 'free_001', kind: 'shape', x: 0, y: 0, w: 10, h: 10 },
      { id: 'free_002', kind: 'text', x: 0, y: 0, w: 10, h: 10, text: 'a' },
    ];
    const next = removeFreeElement(layout, 'free_001');
    expect(next.map((e) => e.id)).toEqual(['free_002']);
  });

  it('存在しない id は変化なし', () => {
    const layout: FreeElement[] = [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 10, h: 10 }];
    expect(removeFreeElement(layout, 'free_999')).toEqual(layout);
  });
});

describe('moveFreeElement', () => {
  it('開始位置に総移動量を加えて整数で返す', () => {
    expect(moveFreeElement({ x: 100, y: 100, w: 200, h: 200 }, 50, -30)).toEqual({ x: 150, y: 70 });
  });
  it('小数の移動量は丸める', () => {
    expect(moveFreeElement({ x: 0, y: 0, w: 10, h: 10 }, 12.4, 12.6)).toEqual({ x: 12, y: 13 });
  });
});

describe('resizeFreeElement', () => {
  const start = { x: 100, y: 100, w: 200, h: 200 }; // 右下 (300,300)

  it('se（右下）は幅・高さを増やし左上を固定', () => {
    expect(resizeFreeElement(start, 'se', 50, 80)).toEqual({ x: 100, y: 100, w: 250, h: 280 });
  });

  it('nw（左上）は対角（右下 300,300）を固定して縮める', () => {
    const r = resizeFreeElement(start, 'nw', 50, 50);
    expect(r).toEqual({ x: 150, y: 150, w: 150, h: 150 });
    expect(r.x + r.w).toBe(300); // 右辺固定
    expect(r.y + r.h).toBe(300); // 下辺固定
  });

  it('ne（右上）は右へ広げつつ上辺を動かし下辺を固定', () => {
    const r = resizeFreeElement(start, 'ne', 40, -60); // 上へ 60 → 高さ +60
    expect(r).toEqual({ x: 100, y: 40, w: 240, h: 260 });
    expect(r.y + r.h).toBe(300); // 下辺固定
  });

  it('最小サイズで止まり、固定辺は保たれる（nw で大きく内側へ）', () => {
    const r = resizeFreeElement(start, 'nw', 1000, 1000, 20);
    expect(r.w).toBe(20);
    expect(r.h).toBe(20);
    expect(r.x + r.w).toBe(300); // 右辺は固定のまま
    expect(r.y + r.h).toBe(300); // 下辺は固定のまま
  });

  it('小数の移動量は丸める', () => {
    expect(resizeFreeElement({ x: 0, y: 0, w: 100, h: 100 }, 'se', 10.6, 10.2)).toEqual({ x: 0, y: 0, w: 111, h: 110 });
  });
});
