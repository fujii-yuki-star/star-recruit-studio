import { describe, expect, it } from 'vitest';
import type { FreeElement } from './types';
import {
  addFreeElement, bringFreeElementToFront, createFreeElement, duplicateFreeElement,
  moveFreeElement, removeFreeElement, resizeFreeElement, sendFreeElementToBack,
  snapToGrid, updateFreeElement,
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

describe('duplicateFreeElement', () => {
  const layout: FreeElement[] = [
    { id: 'free_001', kind: 'text', x: 100, y: 100, w: 200, h: 80, zIndex: 1, text: 'あ', fontSize: 40 },
    { id: 'free_002', kind: 'shape', x: 0, y: 0, w: 50, h: 50, zIndex: 5, shapeType: 'rect', fillColor: '#000000' },
  ];

  it('複製：新 id・最前面(zIndex 最大+1)・少しずらす・他フィールドは引き継ぐ', () => {
    const { freeLayout: next, newId } = duplicateFreeElement(layout, 'free_001');
    expect(next).toHaveLength(3);
    expect(newId).toBe('free_003');
    const copy = next.find((e) => e.id === 'free_003');
    expect(copy?.kind).toBe('text');
    expect(copy?.text).toBe('あ');
    expect(copy?.zIndex).toBe(6); // 既存最大 5 +1
    expect(copy?.x).toBeGreaterThan(100); // 元から少しずれる
    expect(copy?.y).toBeGreaterThan(100);
  });

  it('存在しない id は変化なし・newId=null', () => {
    const { freeLayout: next, newId } = duplicateFreeElement(layout, 'free_999');
    expect(next).toBe(layout);
    expect(newId).toBeNull();
  });
});

describe('bringFreeElementToFront / sendFreeElementToBack', () => {
  const layout: FreeElement[] = [
    { id: 'free_001', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 1 },
    { id: 'free_002', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 2 },
    { id: 'free_003', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 3 },
  ];

  it('前面：他要素の最大+1 になる', () => {
    const next = bringFreeElementToFront(layout, 'free_001');
    expect(next.find((e) => e.id === 'free_001')?.zIndex).toBe(4); // 最大 3 +1
  });

  it('背面：他要素の最小−1 になる', () => {
    const next = sendFreeElementToBack(layout, 'free_003');
    expect(next.find((e) => e.id === 'free_003')?.zIndex).toBe(0); // 最小 1 −1 = 0
  });

  it('背面：0 を下回らない（FREE 背景 z=0 の裏へ回り込まない）', () => {
    const atZero: FreeElement[] = [
      { id: 'free_001', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 0 },
      { id: 'free_002', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 1 },
    ];
    const next = sendFreeElementToBack(atZero, 'free_002');
    expect(next.find((e) => e.id === 'free_002')?.zIndex).toBe(0); // 最小 0 −1 → 0 でクリップ
  });

  it('id 不在・単独要素は変化なし（同一参照）', () => {
    expect(bringFreeElementToFront(layout, 'free_999')).toBe(layout);
    const single: FreeElement[] = [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 1 }];
    expect(bringFreeElementToFront(single, 'free_001')).toBe(single);
    expect(sendFreeElementToBack(single, 'free_001')).toBe(single);
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

  it('sw（左下）は右辺を固定して左へ縮め、下へ伸ばす', () => {
    const r = resizeFreeElement(start, 'sw', 50, 50);
    expect(r).toEqual({ x: 150, y: 100, w: 150, h: 250 });
    expect(r.x + r.w).toBe(300); // 右辺固定
    expect(r.y).toBe(100); // 上辺固定
  });

  it('小数 dx/dy でも固定辺（対角）は整数で厳密に保たれる（NW/NE/SW・1px ずれない）', () => {
    const nw = resizeFreeElement(start, 'nw', 0.6, 0.6);
    expect(nw.x + nw.w).toBe(300); // 右辺
    expect(nw.y + nw.h).toBe(300); // 下辺
    const ne = resizeFreeElement(start, 'ne', 0.6, 0.6);
    expect(ne.y + ne.h).toBe(300); // 下辺固定
    const sw = resizeFreeElement(start, 'sw', 0.6, 0.6);
    expect(sw.x + sw.w).toBe(300); // 右辺固定
    for (const r of [nw, ne, sw]) {
      expect([r.x, r.y, r.w, r.h].every(Number.isInteger)).toBe(true);
    }
  });
});

describe('resizeFreeElement：縦横比維持（Shift / lockAspect）', () => {
  const start = { x: 100, y: 100, w: 200, h: 100 }; // 比 2:1・右下 (300,200)

  it('se：横ドラッグでも比を保ち高さも連動（左上固定）', () => {
    const r = resizeFreeElement(start, 'se', 100, 0, 20, 0, true);
    expect(r).toEqual({ x: 100, y: 100, w: 300, h: 150 });
    expect(r.w / r.h).toBeCloseTo(2, 5);
  });

  it('nw：比を保ち対角（右下 300,200）を固定', () => {
    const r = resizeFreeElement(start, 'nw', 50, 0, 20, 0, true);
    expect(r).toEqual({ x: 150, y: 125, w: 150, h: 75 });
    expect(r.x + r.w).toBe(300); // 右辺固定
    expect(r.y + r.h).toBe(200); // 下辺固定
  });

  it('縮小は最小サイズで止まり比も保つ', () => {
    const r = resizeFreeElement(start, 'se', -500, -500, 20, 0, true);
    expect(r.h).toBe(20); // 短辺が min で止まる
    expect(r.w / r.h).toBeCloseTo(2, 5);
  });

  it('ne：比を保ち対角（左下）を固定（movesNorth/East 分岐）', () => {
    const r = resizeFreeElement(start, 'ne', 100, -50, 20, 0, true);
    expect(r).toEqual({ x: 100, y: 50, w: 300, h: 150 });
    expect(r.x).toBe(100); // 左辺固定
    expect(r.y + r.h).toBe(200); // 下辺固定
    expect(r.w / r.h).toBeCloseTo(2, 5);
  });

  it('sw：比を保ち対角（右上）を固定（movesWest/South 分岐）', () => {
    const r = resizeFreeElement(start, 'sw', -100, 50, 20, 0, true);
    expect(r).toEqual({ x: 0, y: 100, w: 300, h: 150 });
    expect(r.x + r.w).toBe(300); // 右辺固定
    expect(r.y).toBe(100); // 上辺固定
    expect(r.w / r.h).toBeCloseTo(2, 5);
  });
});

describe('snapToGrid とグリッド吸着（FREE 仕上げ）', () => {
  it('snapToGrid：grid>0 は最寄りの倍数、grid<=0 は整数丸めのみ', () => {
    expect(snapToGrid(23, 20)).toBe(20);
    expect(snapToGrid(31, 20)).toBe(40);
    expect(snapToGrid(50, 0)).toBe(50);
    expect(snapToGrid(50.4, 0)).toBe(50); // grid なしは round
  });

  it('moveFreeElement：grid 指定で位置をグリッドに吸着', () => {
    expect(moveFreeElement({ x: 100, y: 100, w: 200, h: 100 }, 27, 3, 20)).toEqual({ x: 120, y: 100 });
  });

  it('moveFreeElement：grid=0（既定）は従来どおり整数丸め', () => {
    expect(moveFreeElement({ x: 100, y: 100, w: 200, h: 100 }, 27, 3)).toEqual({ x: 127, y: 103 });
  });

  it('resizeFreeElement：grid 指定で掴んだ辺を吸着しつつ対角を固定', () => {
    // se：右辺 100+15=115 を grid20 で 120 に吸着 → w=120。左上(0,0)は固定。
    const r = resizeFreeElement({ x: 0, y: 0, w: 100, h: 100 }, 'se', 15, 0, 20, 20);
    expect(r.w).toBe(120);
    expect(r.x).toBe(0);
    // nw：左辺 100+15=115 を 120 に吸着 → 右辺(300)固定で w=180、x=120。
    const r2 = resizeFreeElement({ x: 100, y: 100, w: 200, h: 200 }, 'nw', 15, 0, 20, 20);
    expect(r2.x).toBe(120);
    expect(r2.x + r2.w).toBe(300); // 右辺はグリッドに依らず固定
  });

  it('resizeFreeElement：grid 吸着後に min を下回っても固定辺は保たれる', () => {
    // nw で大きく引き込み、吸着後 w/h が min(20) 未満 → 20 でクリップ。右下(100,100)固定。
    const r = resizeFreeElement({ x: 0, y: 0, w: 100, h: 100 }, 'nw', 90, 90, 20, 20);
    expect(r.w).toBe(20);
    expect(r.h).toBe(20);
    expect(r.x + r.w).toBe(100); // 右辺固定
    expect(r.y + r.h).toBe(100); // 下辺固定
  });

  it('resizeFreeElement：ne/sw も grid 吸着しつつ固定辺を保つ', () => {
    // ne：右辺 100+15=115→120 吸着で w=120、左辺(0)固定。
    const ne = resizeFreeElement({ x: 0, y: 0, w: 100, h: 100 }, 'ne', 15, 0, 20, 20);
    expect(ne.w).toBe(120);
    expect(ne.x).toBe(0);
    // sw：左辺 100−15=85→80 吸着で右辺(200)固定・x=80。
    const sw = resizeFreeElement({ x: 100, y: 0, w: 100, h: 100 }, 'sw', -15, 15, 20, 20);
    expect(sw.x).toBe(80);
    expect(sw.x + sw.w).toBe(200); // 右辺固定
  });
});
