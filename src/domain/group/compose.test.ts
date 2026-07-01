import { describe, expect, it } from 'vitest';
import { composeGroupGeometry, isHiddenByGroup, type Geom } from './compose';
import type { Group, GroupTransform } from './types';

const I: GroupTransform = { x: 0, y: 0, rotation: 0, scale: 1 };
const g = (id: string, members: string[], t: Partial<GroupTransform> = {}, extra: Partial<Group> = {}): Group => ({
  id,
  members,
  transform: { ...I, ...t },
  ...extra,
});
const near = (got: Geom | undefined, exp: Partial<Geom>) => {
  expect(got).toBeDefined();
  if (exp.x !== undefined) expect(got!.x).toBeCloseTo(exp.x, 5);
  if (exp.y !== undefined) expect(got!.y).toBeCloseTo(exp.y, 5);
  if (exp.w !== undefined) expect(got!.w).toBeCloseTo(exp.w, 5);
  if (exp.h !== undefined) expect(got!.h).toBeCloseTo(exp.h, 5);
  if (exp.rotation !== undefined) expect(got!.rotation ?? 0).toBeCloseTo(exp.rotation, 5);
};

describe('composeGroupGeometry', () => {
  it('グループ無しは入力をそのまま返す（後方互換）', () => {
    const els = [{ id: 'a', x: 10, y: 20, w: 30, h: 40, rotation: 15 }];
    const out = composeGroupGeometry(els, []);
    near(out.get('a'), { x: 10, y: 20, w: 30, h: 40, rotation: 15 });
  });

  it('未所属の要素はグループがあってもそのまま', () => {
    const els = [
      { id: 'a', x: 100, y: 100, w: 40, h: 20 },
      { id: 'b', x: 0, y: 0, w: 10, h: 10 },
    ];
    const out = composeGroupGeometry(els, [g('group_001', ['a'], { x: 50 })]);
    near(out.get('b'), { x: 0, y: 0, w: 10, h: 10 }); // b は未所属
  });

  it('平行移動：メンバーの位置が transform 分ずれる', () => {
    const els = [{ id: 'a', x: 100, y: 100, w: 40, h: 20 }];
    const out = composeGroupGeometry(els, [g('group_001', ['a'], { x: 50, y: -20 })]);
    near(out.get('a'), { x: 150, y: 80, w: 40, h: 20, rotation: 0 });
  });

  it('拡大：グループ中心（単一なら要素中心）まわりに scale。中心は不動・サイズ2倍', () => {
    const els = [{ id: 'a', x: 100, y: 100, w: 40, h: 20 }];
    const out = composeGroupGeometry(els, [g('group_001', ['a'], { scale: 2 })]);
    near(out.get('a'), { x: 80, y: 90, w: 80, h: 40 }); // 中心(120,110)固定・80x40
  });

  it('回転：単一メンバーは中心が不動で rotation だけ加算', () => {
    const els = [{ id: 'a', x: 100, y: 100, w: 40, h: 20 }];
    const out = composeGroupGeometry(els, [g('group_001', ['a'], { rotation: 90 })]);
    near(out.get('a'), { x: 100, y: 100, w: 40, h: 20, rotation: 90 });
  });

  it('複数メンバーの回転：各中心がグループ bbox 中心まわりに回る', () => {
    const els = [
      { id: 'a', x: 100, y: 100, w: 20, h: 20 }, // center (110,110)
      { id: 'b', x: 200, y: 100, w: 20, h: 20 }, // center (210,110)
    ];
    // bbox = (100,100,120,20) → 中心 (160,110)。90°CW。
    const out = composeGroupGeometry(els, [g('group_001', ['a', 'b'], { rotation: 90 })]);
    near(out.get('a'), { x: 150, y: 50, rotation: 90 }); // (110,110)→(160,60)
    near(out.get('b'), { x: 150, y: 150, rotation: 90 }); // (210,110)→(160,160)
  });

  it('ネスト：内側→外側の平行移動が加算される', () => {
    const els = [{ id: 'a', x: 0, y: 0, w: 10, h: 10 }];
    const groups = [
      g('group_001', ['a'], { x: 50 }), // 内
      g('group_002', ['group_001'], { x: 100 }), // 外
    ];
    const out = composeGroupGeometry(els, groups);
    near(out.get('a'), { x: 150, y: 0, w: 10, h: 10 }); // 50 + 100
  });

  it('ネスト：外側スケールが内側グループごと拡大する', () => {
    const els = [{ id: 'a', x: 100, y: 100, w: 20, h: 20 }];
    const groups = [
      g('group_001', ['a']), // 内（identity）
      g('group_002', ['group_001'], { scale: 2 }), // 外で2倍
    ];
    const out = composeGroupGeometry(els, groups);
    // group_002 の中心＝group_001 bbox 中心＝a 中心(110,110)。scale2 で中心固定・サイズ2倍（20→40）。
    near(out.get('a'), { x: 90, y: 90, w: 40, h: 40 }); // 110 - 40/2 = 90

  });

  it('循環参照でも停止する（無限ループしない）', () => {
    const els = [{ id: 'a', x: 0, y: 0, w: 10, h: 10 }];
    const groups = [
      g('group_001', ['group_002']),
      g('group_002', ['a', 'group_001']),
    ];
    const out = composeGroupGeometry(els, groups); // 例外・ハングしなければ OK
    expect(out.get('a')).toBeDefined();
  });
});

describe('isHiddenByGroup', () => {
  it('hidden グループのメンバーは true', () => {
    const groups = [g('group_001', ['a'], {}, { hidden: true })];
    expect(isHiddenByGroup('a', groups)).toBe(true);
    expect(isHiddenByGroup('b', groups)).toBe(false);
  });

  it('ネストの親が hidden ならメンバーも true', () => {
    const groups = [
      g('group_001', ['a']),
      g('group_002', ['group_001'], {}, { hidden: true }),
    ];
    expect(isHiddenByGroup('a', groups)).toBe(true);
  });

  it('グループ無しは false', () => {
    expect(isHiddenByGroup('a', [])).toBe(false);
  });
});
