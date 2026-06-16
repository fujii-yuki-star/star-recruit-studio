import { describe, expect, it } from 'vitest';
import type { FreeElement } from './types';
import { addFreeElement, createFreeElement, removeFreeElement, updateFreeElement } from './freeLayoutOps';

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
});
