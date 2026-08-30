import { describe, expect, it } from 'vitest';
import type { FreeElement } from './types';
import type { Group } from '../group/types';
import { composeGroupGeometry } from '../group/compose';
import {
  addFreeElement, applyFreeElementGeoms, applyFreeElementPositions, bringFreeElementToFront, createFreeElement, duplicateFreeElement, elementAtPoint, pointInElement,
  elementVisualBBox, freeElementsInRect, FREE_MIN_SIZE, groupBBox, keyboardNudgeDelta, moveFreeElement, moveFreeElementZ, nudgeFreeElements, pasteFreeElement, removeFreeElement, removeFreeElements, resizeFreeElement, resizeGroup, resizeRotatedFreeElement, rotationFromPointer, sendFreeElementToBack,
  snapAngle, snapToGrid, updateFreeElement,
} from './freeLayoutOps';

describe('createFreeElement / addFreeElement', () => {
  it('空配列に slot を追加：id=free_001・zIndex=1・kind 既定（assetId=null/fit あり）', () => {
    const { freeLayout: next, newId } = addFreeElement([], 'slot');
    expect(next).toHaveLength(1);
    expect(newId).toBe('free_001'); // 追加直後の選択に使う id
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

  it('subtitle の既定値（文言 text を持たず・字幕バーの位置/体裁・ADR-0029）', () => {
    const sub = createFreeElement([], 'subtitle');
    expect(sub.kind).toBe('subtitle');
    expect(sub.text).toBeUndefined(); // 文言は対象（subtitleSource）から解決＝el.text なし
    expect(sub.subtitleSource).toBeUndefined(); // 既定は後方互換（単独→読み上げ・掛け合い→全行）
    expect(sub.color).toBe('#ffffff'); // 白文字＋黒縁で可読性
    expect(sub.strokeColor).toBe('#000000');
    expect(sub.strokeWidth).toBe(6);
    expect(sub.textAlign).toBe('center');
    expect(sub.fontSize).toBeGreaterThan(0);
  });

  it('subtitle も canvas 比でスケール（縦型は幅・fontSize が縮む・#273 と同じ流儀）', () => {
    const land = createFreeElement([], 'subtitle', 1920, 1080);
    const port = createFreeElement([], 'subtitle', 1080, 1920);
    expect(port.w).toBeLessThan(land.w);
    expect(port.fontSize).toBeLessThan(land.fontSize ?? 0);
  });

  it('canvas 比で既定の位置・大きさをスケール（横型は不変・縦型は幅が画面に対し過大にならない・#273）', () => {
    const ref = createFreeElement([], 'text'); // 引数なし＝横型基準（1920×1080）
    const land = createFreeElement([], 'text', 1920, 1080);
    expect(land.w).toBe(ref.w); // 横型 1920×1080 は係数1＝従来どおり
    expect(land.x).toBe(ref.x);

    const port = createFreeElement([], 'text', 1080, 1920);
    expect(port.w).toBeLessThan(land.w); // 縦型は幅が縮む（画面いっぱいで中央寄りに見える違和感を防ぐ）
    expect(port.fontSize).toBeLessThan(land.fontSize ?? 0); // fontSize も幅基準でスケール（文字と枠の比率を一定に）
    // 画面幅に対する占有率は横型と同程度（比例スケール）。
    expect(port.w / 1080).toBeCloseTo(land.w / 1920, 2);
    expect(port.x / 1080).toBeCloseTo(land.x / 1920, 2);
    expect((port.fontSize ?? 0) / 1080).toBeCloseTo((land.fontSize ?? 0) / 1920, 2);
    expect(port.y).toBeGreaterThan(land.y); // 縦方向は canvasH 基準＝縦型では下に伸びる
  });

  it('追加のたびに id が連番・zIndex が最前面+1 になる', () => {
    let layout: FreeElement[] = [];
    layout = addFreeElement(layout, 'shape').freeLayout; // free_001 z=1
    layout = addFreeElement(layout, 'text').freeLayout; // free_002 z=2
    layout = addFreeElement(layout, 'slot').freeLayout; // free_003 z=3
    expect(layout.map((e) => e.id)).toEqual(['free_001', 'free_002', 'free_003']);
    expect(layout.map((e) => e.zIndex)).toEqual([1, 2, 3]);
  });

  it('既存の最大 zIndex を踏まえて最前面に積む', () => {
    const existing: FreeElement[] = [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 50 }];
    const next = addFreeElement(existing, 'text').freeLayout;
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

describe('freeElementsInRect（範囲選択・マーキー・#274）', () => {
  const layout: FreeElement[] = [
    { id: 'free_001', kind: 'shape', x: 0, y: 0, w: 100, h: 100 },
    { id: 'free_002', kind: 'text', x: 300, y: 300, w: 100, h: 100, text: 'あ' },
    { id: 'free_003', kind: 'shape', x: 1000, y: 50, w: 100, h: 100 },
  ];

  it('矩形と AABB が交差する要素だけ返す（接するだけ/外側は含めない）', () => {
    // free_001 を囲む矩形（free_002/003 は外）。
    expect(freeElementsInRect(layout, { x0: -10, y0: -10, x1: 120, y1: 120 })).toEqual(['free_001']);
    // free_001 と free_002 をまたぐ矩形。
    expect(freeElementsInRect(layout, { x0: 50, y0: 50, x1: 350, y1: 350 })).toEqual(['free_001', 'free_002']);
    // どの要素にも触れない矩形＝空。
    expect(freeElementsInRect(layout, { x0: 500, y0: 500, x1: 600, y1: 600 })).toEqual([]);
  });

  it('2点は順不同（右下→左上のドラッグでも同じ）', () => {
    const a = freeElementsInRect(layout, { x0: 50, y0: 50, x1: 350, y1: 350 });
    const b = freeElementsInRect(layout, { x0: 350, y0: 350, x1: 50, y1: 50 });
    expect(b).toEqual(a);
  });

  it('非表示・ロック中の要素は対象外（一括操作に巻き込まない）', () => {
    const withFlags: FreeElement[] = [
      { id: 'free_001', kind: 'shape', x: 0, y: 0, w: 100, h: 100, hidden: true },
      { id: 'free_002', kind: 'shape', x: 0, y: 0, w: 100, h: 100, locked: true },
      { id: 'free_003', kind: 'shape', x: 0, y: 0, w: 100, h: 100 },
    ];
    expect(freeElementsInRect(withFlags, { x0: -10, y0: -10, x1: 110, y1: 110 })).toEqual(['free_003']);
  });
});

describe('elementVisualBBox（回転後の見た目 AABB・#300）', () => {
  it('rotation 未指定/0 は素の矩形と一致', () => {
    expect(elementVisualBBox({ x: 10, y: 20, w: 100, h: 40 })).toEqual({ x: 10, y: 20, w: 100, h: 40 });
    expect(elementVisualBBox({ x: 10, y: 20, w: 100, h: 40, rotation: 0 })).toEqual({ x: 10, y: 20, w: 100, h: 40 });
  });

  it('90°回転は幅高さが入れ替わり、中心は不変', () => {
    const b = elementVisualBBox({ x: 100, y: 100, w: 200, h: 100, rotation: 90 });
    expect(b.w).toBeCloseTo(100);
    expect(b.h).toBeCloseTo(200);
    expect(b.x + b.w / 2).toBeCloseTo(200); // 中心 x は不変
    expect(b.y + b.h / 2).toBeCloseTo(150); // 中心 y は不変
  });

  it('45°回転は AABB が広がる（正方形なら √2 倍・中心不変）', () => {
    const b = elementVisualBBox({ x: 0, y: 0, w: 100, h: 100, rotation: 45 });
    expect(b.w).toBeCloseTo(100 * Math.SQRT2);
    expect(b.h).toBeCloseTo(100 * Math.SQRT2);
    expect(b.x + b.w / 2).toBeCloseTo(50);
    expect(b.y + b.h / 2).toBeCloseTo(50);
  });
});

describe('groupBBox / resizeGroup / applyFreeElementGeoms（複数同時リサイズ・#274）', () => {
  const els: FreeElement[] = [
    { id: 'free_001', kind: 'shape', x: 100, y: 100, w: 100, h: 100 },
    { id: 'free_002', kind: 'shape', x: 300, y: 200, w: 100, h: 100 },
  ];

  it('groupBBox は全要素を囲む最小矩形（空は null）', () => {
    expect(groupBBox([])).toBeNull();
    expect(groupBBox(els)).toEqual({ x: 100, y: 100, w: 300, h: 200 }); // (100,100)..(400,300)
  });

  it('groupBBox は回転要素を見た目（回転後 AABB）で囲む（#300(a)）', () => {
    // 200×100 を 90°回転すると見た目は 100×200。中心 (200,150) を保つ→ (150,50)..(250,250)。
    const rotated: FreeElement[] = [{ id: 'free_001', kind: 'shape', x: 100, y: 100, w: 200, h: 100, rotation: 90 }];
    const b = groupBBox(rotated)!;
    expect(b.x).toBeCloseTo(150);
    expect(b.y).toBeCloseTo(50);
    expect(b.w).toBeCloseTo(100);
    expect(b.h).toBeCloseTo(200);
  });

  it('resizeGroup：bbox を2倍にすると各要素の相対位置・大きさが保たれて2倍になる', () => {
    const old = { x: 100, y: 100, w: 300, h: 200 };
    const next = { x: 100, y: 100, w: 600, h: 400 }; // 左上固定で幅高さ2倍
    expect(resizeGroup(els, old, next)).toEqual([
      { id: 'free_001', x: 100, y: 100, w: 200, h: 200 },
      { id: 'free_002', x: 500, y: 300, w: 200, h: 200 },
    ]);
  });

  it('resizeGroup：極端な縮小でも各要素は FREE_MIN_SIZE 以上にクランプ（消えない）', () => {
    const tiny: FreeElement[] = [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 100, h: 100 }];
    const out = resizeGroup(tiny, { x: 0, y: 0, w: 1000, h: 1000 }, { x: 0, y: 0, w: 1, h: 1 });
    expect(out[0].w).toBe(FREE_MIN_SIZE);
    expect(out[0].h).toBe(FREE_MIN_SIZE);
  });

  it('applyFreeElementGeoms：指定 id の x,y,w,h を反映し未指定は不変・空は同一参照', () => {
    const out = applyFreeElementGeoms(els, [{ id: 'free_002', x: 0, y: 0, w: 50, h: 50 }]);
    expect(out[0]).toEqual(els[0]); // free_001 不変
    expect(out[1]).toMatchObject({ id: 'free_002', x: 0, y: 0, w: 50, h: 50 });
    expect(applyFreeElementGeoms(els, [])).toBe(els);
  });
});

describe('rotationFromPointer / snapAngle（回転ハンドル・#279）', () => {
  const c = { x: 0, y: 0 };

  it('要素中心からの角度：上=0°・右=90°・下=180°・左=270°（時計回り）', () => {
    expect(rotationFromPointer(c, { x: 0, y: -100 })).toBe(0); // 上（12時）
    expect(rotationFromPointer(c, { x: 100, y: 0 })).toBe(90); // 右
    expect(rotationFromPointer(c, { x: 0, y: 100 })).toBe(180); // 下
    expect(rotationFromPointer(c, { x: -100, y: 0 })).toBe(270); // 左
  });

  it('0≤r<360 に正規化（360 は出さない）', () => {
    const r = rotationFromPointer(c, { x: -1, y: -1000 });
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(360);
  });

  it('snapAngle：15°きざみに吸着し 0≤r<360 に正規化', () => {
    expect(snapAngle(37, 15)).toBe(30);
    expect(snapAngle(38, 15)).toBe(45);
    expect(snapAngle(358, 15)).toBe(0); // 360→0
    expect(snapAngle(100, 0)).toBe(100); // step<=0 は正規化のみ
    expect(snapAngle(-30, 0)).toBe(330);
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

describe('pasteFreeElement（コピー&ペースト・場面間も可）', () => {
  it('別場面の要素を貼り付け：貼付先で新 id を採番・最前面・少しずらす・他フィールド引継ぎ', () => {
    // コピー元（別場面の要素を想定）。貼付先 freeLayout には free_001 が既存。
    const copied: FreeElement = { id: 'free_005', kind: 'text', x: 100, y: 100, w: 200, h: 80, zIndex: 9, text: 'コピー', fontSize: 40 };
    const target: FreeElement[] = [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 50, h: 50, zIndex: 3, shapeType: 'rect', fillColor: '#000000' }];
    const { freeLayout: next, newId } = pasteFreeElement(target, copied);
    expect(next).toHaveLength(2);
    expect(newId).toBe('free_002'); // 貼付先の空き番号（元の free_005 ではない）
    const pasted = next.find((e) => e.id === 'free_002');
    expect(pasted).toMatchObject({ kind: 'text', text: 'コピー' });
    expect(pasted?.zIndex).toBe(4); // 貼付先の最大 3 +1
    expect(pasted?.x).toBe(120); // 元 100 + ずらし
    expect(pasted?.y).toBe(120);
  });

  it('空の貼付先にも貼れる（newId=free_001）', () => {
    const copied: FreeElement = { id: 'free_009', kind: 'shape', x: 10, y: 10, w: 30, h: 30, zIndex: 2, shapeType: 'star', fillColor: '#ff0000' };
    const { freeLayout: next, newId } = pasteFreeElement([], copied);
    expect(newId).toBe('free_001');
    expect(next[0]).toMatchObject({ id: 'free_001', shapeType: 'star' });
  });
});

describe('applyFreeElementPositions（複数選択の一括移動）', () => {
  const layout: FreeElement[] = [
    { id: 'free_001', kind: 'shape', x: 100, y: 100, w: 50, h: 50, zIndex: 1, shapeType: 'rect', fillColor: '#000' },
    { id: 'free_002', kind: 'shape', x: 200, y: 200, w: 50, h: 50, zIndex: 2, shapeType: 'rect', fillColor: '#000' },
    { id: 'free_003', kind: 'text', x: 300, y: 300, w: 50, h: 50, zIndex: 3, text: 'あ', fontSize: 40 },
  ];

  it('指定した複数要素の位置だけ更新し、他要素・他フィールドは不変', () => {
    const next = applyFreeElementPositions(layout, [
      { id: 'free_001', x: 110, y: 120 },
      { id: 'free_003', x: 330, y: 340 },
    ]);
    expect(next.find((e) => e.id === 'free_001')).toMatchObject({ x: 110, y: 120, w: 50 }); // w 等は不変
    expect(next.find((e) => e.id === 'free_002')).toBe(layout[1]); // 対象外は同一参照
    expect(next.find((e) => e.id === 'free_003')).toMatchObject({ x: 330, y: 340, text: 'あ' });
  });

  it('moves が空なら同一参照を返す', () => {
    expect(applyFreeElementPositions(layout, [])).toBe(layout);
  });
});

describe('removeFreeElements（複数選択の一括削除）', () => {
  const layout: FreeElement[] = [
    { id: 'free_001', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 1 },
    { id: 'free_002', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 2 },
    { id: 'free_003', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 3 },
  ];

  it('指定 id をまとめて削除（未知 id は無視）', () => {
    const next = removeFreeElements(layout, ['free_001', 'free_003', 'free_999']);
    expect(next.map((e) => e.id)).toEqual(['free_002']);
  });

  it('ids が空なら同一参照を返す', () => {
    expect(removeFreeElements(layout, [])).toBe(layout);
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

describe('moveFreeElementZ（レイヤー一覧の1段移動・#210）', () => {
  const layout: FreeElement[] = [
    { id: 'a', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 1 },
    { id: 'b', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 2 },
    { id: 'c', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 3 },
  ];
  const zById = (l: FreeElement[]) => Object.fromEntries(l.map((e) => [e.id, e.zIndex]));

  it('up：1段前面へ＝隣（次に大きい z）と入れ替え', () => {
    expect(zById(moveFreeElementZ(layout, 'a', 'up'))).toMatchObject({ a: 2, b: 1, c: 3 });
  });

  it('down：1段背面へ＝隣（次に小さい z）と入れ替え', () => {
    expect(zById(moveFreeElementZ(layout, 'c', 'down'))).toMatchObject({ a: 1, b: 3, c: 2 });
  });

  it('端（最前面を up / 最背面を down）は変化なし（同一参照）', () => {
    expect(moveFreeElementZ(layout, 'c', 'up')).toBe(layout);
    expect(moveFreeElementZ(layout, 'a', 'down')).toBe(layout);
    expect(moveFreeElementZ(layout, 'zzz', 'up')).toBe(layout); // 不在
  });

  // #587：同 zIndex は**配列の順**で前後が決まる（描画 `layout.ts` の安定ソート・レイヤー一覧の並びと同じ）。
  // 旧実装は z を ±1 して前後を付けていたが、3つ以上並ぶと1段を表現できず（グループごと飛び越える）、
  // 繰り返すと種別ごとの既定 z の階層へ食い込んだ。
  const tie = (ids: string[]): FreeElement[] =>
    ids.map((id) => ({ id, kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 5 }) as FreeElement);
  /** 実際の重なり順（奥→手前）＝z 昇順の安定ソート＝同 z は配列の後ろが手前。 */
  const order = (l: FreeElement[]): string[] =>
    [...l].sort((a, b) => (a.zIndex ?? 1) - (b.zIndex ?? 1)).map((e) => e.id);

  it('同 zIndex のときは配列の順で入れ替わる（zIndex は増やさない）', () => {
    const moved = moveFreeElementZ(tie(['a', 'b']), 'a', 'up');
    expect(order(moved)).toEqual(['b', 'a']);
    expect(zById(moved)).toMatchObject({ a: 5, b: 5 }); // z は据え置き＝階層へ食い込まない
  });

  it('同 zIndex が3つ以上でも、動くのはちょうど1段だけ', () => {
    const three = tie(['a', 'b', 'c']);
    expect(order(moveFreeElementZ(three, 'a', 'up'))).toEqual(['b', 'a', 'c']); // 旧実装は ['b','c','a']
    expect(order(moveFreeElementZ(three, 'c', 'down'))).toEqual(['a', 'c', 'b']);
  });

  it('zIndex が 0 どうしでも背面へ動く（0 で頭打ちにならない）', () => {
    const zeros: FreeElement[] = [
      { id: 'a', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 0 },
      { id: 'b', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 0 },
    ];
    expect(order(moveFreeElementZ(zeros, 'b', 'down'))).toEqual(['b', 'a']);
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

describe('resizeRotatedFreeElement（回転要素の角リサイズ・#279後継）', () => {
  const start = { x: 100, y: 100, w: 200, h: 100 };
  // 角の canvas 位置 = 中心 + rotate(θ)·(符号·w/2, 符号·h/2)（CSS/SVG rotate と同じ向き）。
  const cornerCanvas = (g: { x: number; y: number; w: number; h: number }, rotDeg: number, sx: number, sy: number) => {
    const r = (rotDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const cx = g.x + g.w / 2, cy = g.y + g.h / 2, lx = (sx * g.w) / 2, ly = (sy * g.h) / 2;
    return { x: cx + (lx * c - ly * s), y: cy + (lx * s + ly * c) };
  };

  it('rotation=0 は resizeFreeElement と一致（恒等）', () => {
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
      expect(resizeRotatedFreeElement(start, corner, 30, 20, 0)).toEqual(resizeFreeElement(start, corner, 30, 20));
    }
  });

  it('回転していても掴んだ角の対角は canvas 上で動かない（se→対角 nw を固定）', () => {
    const rot = 35;
    const r = resizeRotatedFreeElement(start, 'se', 40, 25, rot);
    const before = cornerCanvas(start, rot, -1, -1); // nw
    const after = cornerCanvas(r, rot, -1, -1);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1.5); // 丸め誤差のみ
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1.5);
    expect(r.w).not.toBe(start.w); // リサイズは効いている
  });

  it('nw を掴むと対角（se）が canvas 上で動かない', () => {
    const rot = 100;
    const r = resizeRotatedFreeElement(start, 'nw', -30, 20, rot);
    const before = cornerCanvas(start, rot, 1, 1); // se
    const after = cornerCanvas(r, rot, 1, 1);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1.5);
  });

  it('ne を掴むと対角（sw）が canvas 上で動かない', () => {
    const rot = 60;
    const r = resizeRotatedFreeElement(start, 'ne', 30, -20, rot);
    const before = cornerCanvas(start, rot, -1, 1); // sw
    const after = cornerCanvas(r, rot, -1, 1);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1.5);
  });

  it('sw を掴むと対角（ne）が canvas 上で動かない', () => {
    const rot = 200;
    const r = resizeRotatedFreeElement(start, 'sw', -25, 30, rot);
    const before = cornerCanvas(start, rot, 1, -1); // ne
    const after = cornerCanvas(r, rot, 1, -1);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1.5);
  });

  it('最小サイズで止まり、固定角を超えて振り切っても反転膨張しない（#300 レビュー）', () => {
    // 縮め過ぎ＝min 以上。
    const r = resizeRotatedFreeElement(start, 'se', -999, -999, 90, 24);
    expect(r.w).toBeGreaterThanOrEqual(24);
    expect(r.h).toBeGreaterThanOrEqual(24);
    // 対角(nw)を両軸で超えて振り切っても w も h も min に張り付く（以前は abs 先取りで符号反転→再拡大していた）。
    const over = resizeRotatedFreeElement(start, 'se', 300, -400, 90, 24);
    expect(over.w).toBe(24);
    expect(over.h).toBe(24);
    // 片軸だけ振り切り（レビュー再現：dx=0, dy=-500）でも掴んだ軸は min に張り付く（以前は |200-500|=300 に膨張）。
    expect(resizeRotatedFreeElement(start, 'se', 0, -500, 90, 24).w).toBe(24);
  });

  it('グリッド ON：回転要素でも掴んだ角が canvas グリッドに乗る（#300(b)）', () => {
    const grid = 20;
    const r = resizeRotatedFreeElement(start, 'se', 37, 23, 90, FREE_MIN_SIZE, grid);
    const c = cornerCanvas(r, 90, 1, 1); // 結果の se 角（canvas 位置）
    // ローカル系 snap では乗らなかった「回転後の見た目の角」が canvas グリッドの倍数に乗る。
    expect(Math.round(c.x) % grid).toBe(0);
    expect(Math.round(c.y) % grid).toBe(0);
    // 対角（nw）は canvas 上で動かない（吸着しても対角固定は保つ）。
    const before = cornerCanvas(start, 90, -1, -1);
    const after = cornerCanvas(r, 90, -1, -1);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1.5);
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

describe('nudgeFreeElements（キーボード微調整・#525-11）', () => {
  const layout: FreeElement[] = [
    { id: 'free_001', kind: 'shape', x: 100, y: 100, w: 50, h: 50 },
    { id: 'free_002', kind: 'shape', x: 200, y: 200, w: 50, h: 50, locked: true },
    { id: 'free_003', kind: 'text', x: 0, y: 0, w: 50, h: 50, text: 'a' },
  ];

  it('未所属の要素は画面デルタ＝base デルタ（1:1）', () => {
    const moves = nudgeFreeElements(layout, [], ['free_001', 'free_003'], 1, -1);
    expect(moves).toEqual([{ id: 'free_001', x: 101, y: 99 }, { id: 'free_003', x: 1, y: -1 }]);
  });

  it('ロック要素は動かさない（除外）', () => {
    const moves = nudgeFreeElements(layout, [], ['free_001', 'free_002'], 10, 0);
    expect(moves).toEqual([{ id: 'free_001', x: 110, y: 100 }]); // free_002(locked) は含まれない
  });

  it('存在しない id は無視・空選択は空配列', () => {
    expect(nudgeFreeElements(layout, [], ['zzz'], 1, 1)).toEqual([]);
    expect(nudgeFreeElements(layout, [], [], 1, 1)).toEqual([]);
  });

  it('純並進グループのメンバーは画面 1:1（合成後の実移動量で検証・#525-11 レビュー P2）', () => {
    // 複数メンバー群にして anchor が定義される状況で、純並進の内部メンバーが画面どおり動くことを compose で実測。
    const multi: FreeElement[] = [
      { id: 'free_001', kind: 'shape', x: 100, y: 100, w: 50, h: 50 },
      { id: 'free_002', kind: 'shape', x: 400, y: 400, w: 50, h: 50 },
    ];
    const g: Group = { id: 'group_001', members: ['free_001', 'free_002'], transform: { x: 50, y: -30, rotation: 0, scale: 1 } };
    const moves = nudgeFreeElements(multi, [g], ['free_001'], 3, -2); // 画面 +3,-2 を意図
    const after = applyFreeElementPositions(multi, moves);
    const before = composeGroupGeometry(multi, [g]).get('free_001')!;
    const now = composeGroupGeometry(after, [g]).get('free_001')!;
    expect(now.x - before.x).toBeCloseTo(3, 5); // 合成後の画面移動が意図どおり（純並進＝厳密1:1）
    expect(now.y - before.y).toBeCloseTo(-2, 5);
  });

  it('拡縮グループのメンバーは nudge 対象外（select-only・#542 と一貫・#525-11 レビュー P2）', () => {
    const g: Group = { id: 'group_001', members: ['free_001'], transform: { x: 0, y: 0, rotation: 0, scale: 2 } };
    expect(nudgeFreeElements(layout, [g], ['free_001'], 4, 0)).toEqual([]); // 動かさない
  });

  it('回転グループのメンバーも nudge 対象外（単一回転の逆方向＝壊れて見えるを出さない）', () => {
    const g: Group = { id: 'group_001', members: ['free_001'], transform: { x: 0, y: 0, rotation: 90, scale: 1 } };
    expect(nudgeFreeElements(layout, [g], ['free_001'], 1, 0)).toEqual([]);
  });

  it('混在選択：未所属は 1:1・変形メンバーは据え置き（対象外）', () => {
    const g: Group = { id: 'group_001', members: ['free_001'], transform: { x: 0, y: 0, rotation: 0, scale: 2 } };
    const moves = nudgeFreeElements(layout, [g], ['free_001', 'free_003'], 2, 0);
    expect(moves).toEqual([{ id: 'free_003', x: 2, y: 0 }]); // 未所属のみ・変形メンバー(free_001)は除外
  });
});

describe('keyboardNudgeDelta（矢印→移動量・#525-11）', () => {
  it('矢印は 1px、Shift で 10px', () => {
    expect(keyboardNudgeDelta('ArrowLeft', false)).toEqual({ dx: -1, dy: 0 });
    expect(keyboardNudgeDelta('ArrowRight', false)).toEqual({ dx: 1, dy: 0 });
    expect(keyboardNudgeDelta('ArrowUp', false)).toEqual({ dx: 0, dy: -1 });
    expect(keyboardNudgeDelta('ArrowDown', false)).toEqual({ dx: 0, dy: 1 });
    expect(keyboardNudgeDelta('ArrowRight', true)).toEqual({ dx: 10, dy: 0 }); // Shift=10px
    expect(keyboardNudgeDelta('ArrowUp', true)).toEqual({ dx: 0, dy: -10 });
  });
  it('矢印以外は null', () => {
    expect(keyboardNudgeDelta('a', false)).toBeNull();
    expect(keyboardNudgeDelta('Enter', false)).toBeNull();
  });
});

// #548/#552：グループ枠が内部クリックを貪欲に食わないよう、「ポインタの下に実際は何があるか」を判定する
// ヒットテスト。枠は不透明でグループの外接矩形**全域**を覆うため、この判定でメンバー／グループ外の要素／空白へ分岐する。
describe('pointInElement（回転を考慮した点の内外判定・#548/#552）', () => {
  const rect = { x: 100, y: 100, w: 200, h: 100 }; // 中心 (200,150)

  it('回転なし：矩形の中は true・外は false', () => {
    expect(pointInElement(rect, { x: 200, y: 150 })).toBe(true); // 中心
    expect(pointInElement(rect, { x: 105, y: 105 })).toBe(true); // 左上寄り
    expect(pointInElement(rect, { x: 99, y: 150 })).toBe(false); // 左外
    expect(pointInElement(rect, { x: 200, y: 201 })).toBe(false); // 下外
  });

  it('回転あり：AABB の中でも回転後の矩形の外なら false（軸平行判定では取り違える点）', () => {
    const rotated = { ...rect, rotation: 90 }; // 中心まわりに90°＝縦長 100x200 相当に見える
    expect(pointInElement(rotated, { x: 200, y: 150 })).toBe(true); // 中心は回転しても中
    // 回転前は中（x=290,y=150＝右端寄り）だが、90°回すとその位置は矩形の外になる。
    expect(pointInElement(rect, { x: 290, y: 150 })).toBe(true);
    expect(pointInElement(rotated, { x: 290, y: 150 })).toBe(false);
    // 逆に回転前は外（真下）だが、90°回すと中に入る。
    expect(pointInElement(rect, { x: 200, y: 195 })).toBe(true);
    expect(pointInElement({ ...rect, rotation: 90 }, { x: 200, y: 240 })).toBe(true);
  });
});

describe('elementAtPoint（点に当たる最前面の要素・#548/#552）', () => {
  it('描画順（奥→手前）で最後に当たったものを返す＝重なりは手前が勝つ', () => {
    const items = [
      { id: 'back', x: 0, y: 0, w: 200, h: 200 },
      { id: 'front', x: 50, y: 50, w: 100, h: 100 }, // back の上に重なる
    ];
    expect(elementAtPoint(items, { x: 100, y: 100 })).toBe('front'); // 重なり部分＝手前
    expect(elementAtPoint(items, { x: 10, y: 10 })).toBe('back'); // back だけの場所
  });

  it('どれにも当たらなければ null（＝枠内の空白＝グループ移動へ回す）', () => {
    expect(elementAtPoint([{ id: 'a', x: 0, y: 0, w: 10, h: 10 }], { x: 500, y: 500 })).toBeNull();
    expect(elementAtPoint([], { x: 0, y: 0 })).toBeNull();
  });
});

// ⚠️ **未指定はキーごと落とす**（差分再監査 10巡目）＝素の差し替えだと**値なしのキーが残り**、
// 保存では消えるのにその場の文書には残る（同じ絵の文書が2通りできる）。
describe('updateFreeElement の未指定', () => {
  const el = (): FreeElement =>
    ({ id: 'free_001', kind: 'text', x: 0, y: 0, w: 10, h: 10, text: 'あ', fontId: 'gen-interface-jp' }) as FreeElement;

  it('未指定を書くとキーごと落ちる', () => {
    const [next] = updateFreeElement([el()], 'free_001', { fontId: undefined });
    expect('fontId' in next).toBe(false);
  });

  it('値を書けば入る（落とすのは未指定のときだけ）', () => {
    const [next] = updateFreeElement([el()], 'free_001', { fontId: 'kaitou-yokoku-gothic' });
    expect(next.fontId).toBe('kaitou-yokoku-gothic');
  });

  it('null は残す（`null` を意味として使う項目があるため落とさない）', () => {
    const [next] = updateFreeElement([el()], 'free_001', { assetId: null } as never);
    expect(next.assetId).toBeNull();
  });

  it('触っていないキーは残る', () => {
    const [next] = updateFreeElement([el()], 'free_001', { fontId: undefined });
    expect(next.text).toBe('あ');
  });

  it('別の要素は触らない', () => {
    const other = { ...el(), id: 'free_002' };
    const list = updateFreeElement([el(), other], 'free_001', { fontId: undefined });
    expect(list[1].fontId).toBe('gen-interface-jp');
  });
});
