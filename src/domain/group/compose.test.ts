import { describe, expect, it } from 'vitest';
import { composeGroupGeometry, isGroupHidden, isHiddenByGroup, orientedGroupFrame, type Geom } from './compose';
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

describe('isGroupHidden（自身＋祖先・#525-9 レビュー）', () => {
  it('グループ自身が hidden なら true（isHiddenByGroup は祖先のみゆえ自身を足す）', () => {
    const groups = [g('group_001', ['a'], {}, { hidden: true })];
    expect(isGroupHidden('group_001', groups)).toBe(true);
    expect(isHiddenByGroup('group_001', groups)).toBe(false); // 自身は見ない（差分の確認）
  });

  it('祖先グループが hidden なら true（ネスト）', () => {
    const groups = [
      g('group_001', ['a']),
      g('group_002', ['group_001'], {}, { hidden: true }),
    ];
    expect(isGroupHidden('group_001', groups)).toBe(true);
  });

  it('非表示でない/存在しないグループは false', () => {
    const groups = [g('group_001', ['a'])];
    expect(isGroupHidden('group_001', groups)).toBe(false);
    expect(isGroupHidden('group_999', groups)).toBe(false);
  });
});

describe('orientedGroupFrame（回転メンバー込みで pivot が描画と一致・#525-10）', () => {
  // A＝非回転、B＝90°回転（縦長化）で bbox が回転前後で変わる非対称配置。
  const A = { id: 'a', x: 0, y: 0, w: 100, h: 100 };
  const B = { id: 'b', x: 200, y: 0, w: 100, h: 20, rotation: 90 };
  const centerOf = (r: Geom) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  it('回転メンバーなしは素の外接矩形（後方互換）', () => {
    const els = [{ id: 'a', x: 10, y: 20, w: 30, h: 40 }, { id: 'b', x: 100, y: 100, w: 20, h: 20 }];
    const f = orientedGroupFrame(g('group_001', ['a', 'b']), els);
    expect(f).not.toBeNull();
    expect(f!.cx).toBeCloseTo(65, 5); // bbox (10,20)-(120,120) 中心
    expect(f!.cy).toBeCloseTo(70, 5);
    expect(f!.w).toBeCloseTo(110, 5);
    expect(f!.h).toBeCloseTo(100, 5);
  });

  it('回転メンバーを含むと中心が回転後 AABB 基準になる（素の bbox 中心 150,50 とは異なる）', () => {
    const f = orientedGroupFrame(g('group_001', ['a', 'b']), [A, B]);
    expect(f!.cx).toBeCloseTo(130, 5);
    expect(f!.cy).toBeCloseTo(30, 5);
  });

  it('枠中心＝composeGroupGeometry の拡縮 pivot（回転メンバー込み・不動点で照合）', () => {
    const frame = orientedGroupFrame(g('group_001', ['a', 'b']), [A, B])!;
    const c1 = centerOf(composeGroupGeometry([A, B], [g('group_001', ['a', 'b'], { scale: 1 })]).get('a')!);
    const c2 = centerOf(composeGroupGeometry([A, B], [g('group_001', ['a', 'b'], { scale: 2 })]).get('a')!);
    // scale の不動点 F：center(scale2)=F+(center(scale1)-F)*2 ⇒ F=2*c1-c2。枠中心と一致すれば pivot が描画と同じ。
    expect(2 * c1.x - c2.x).toBeCloseTo(frame.cx, 5);
    expect(2 * c1.y - c2.y).toBeCloseTo(frame.cy, 5);
  });

  it('枠中心＝composeGroupGeometry の回転 pivot（回転で中心が不動）', () => {
    const frame = orientedGroupFrame(g('group_001', ['a', 'b']), [A, B])!;
    // 90°回転しても枠中心まわりに回るだけ＝メンバー集合の重心（回転後 AABB 基準）は枠中心のまわりで対称に動く。
    const r0 = composeGroupGeometry([A, B], [g('group_001', ['a', 'b'], { rotation: 0 })]);
    const r90 = composeGroupGeometry([A, B], [g('group_001', ['a', 'b'], { rotation: 90 })]);
    // メンバー a の中心が枠中心まわりに 90°回った位置に来る（pivot が frame 中心である証拠）。
    const p0 = centerOf(r0.get('a')!);
    const p90 = centerOf(r90.get('a')!);
    // (p0 - center) を 90°CW 回すと (p90 - center) になる：(dx,dy)->(-dy,dx)。
    const dx = p0.x - frame.cx, dy = p0.y - frame.cy;
    expect(frame.cx - dy).toBeCloseTo(p90.x, 5);
    expect(frame.cy + dx).toBeCloseTo(p90.y, 5);
  });

  it('平行移動・scale・rotation を反映する', () => {
    const f = orientedGroupFrame(g('group_001', ['a', 'b'], { x: 10, y: -5, scale: 2, rotation: 30 }), [A, B]);
    expect(f!.cx).toBeCloseTo(140, 5); // 130 + 10
    expect(f!.cy).toBeCloseTo(25, 5); // 30 - 5
    expect(f!.w).toBeCloseTo(520, 5); // 260 * 2
    expect(f!.h).toBeCloseTo(280, 5); // 140 * 2
    expect(f!.rotation).toBeCloseTo(30, 5);
  });

  it('メンバー不在は null', () => {
    expect(orientedGroupFrame(g('group_001', ['zzz']), [A])).toBeNull();
  });
});
