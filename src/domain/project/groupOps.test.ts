import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM, createGroupFromSelection, groupElementIds, removeMembersFromGroups, reorderGroupZ, toggleGroupFlag,
  topGroupOfMember, ungroupGroup, updateGroupMeta, updateGroupTransform,
} from './groupOps';
import type { Group } from '../group/types';
import type { FreeElement } from './types';

const grp = (id: string, members: string[], t = {}): Group => ({ id, members, transform: { ...IDENTITY_TRANSFORM, ...t } });
const shape = (id: string, x: number, y: number, w = 40, h = 20): FreeElement => ({ id, kind: 'shape', x, y, w, h });

describe('createGroupFromSelection', () => {
  it('選択 id を members にした identity グループを採番して追加する', () => {
    const { groups, groupId } = createGroupFromSelection([], ['free_001', 'free_002']);
    expect(groupId).toBe('group_001');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 'group_001', members: ['free_001', 'free_002'], transform: IDENTITY_TRANSFORM });
  });
  it('既存グループがあれば歯抜けの最小番号を採る', () => {
    const { groupId } = createGroupFromSelection([grp('group_001', ['a']), grp('group_003', ['b'])], ['c']);
    expect(groupId).toBe('group_002');
  });
});

describe('updateGroupTransform / updateGroupMeta', () => {
  it('transform の指定フィールドだけ置換する', () => {
    const groups = updateGroupTransform([grp('group_001', ['a'])], 'group_001', { x: 50, y: 20 });
    expect(groups[0].transform).toEqual({ x: 50, y: 20, rotation: 0, scale: 1 });
  });
  it('hidden/locked を更新する', () => {
    const groups = updateGroupMeta([grp('group_001', ['a'])], 'group_001', { hidden: true, locked: true });
    expect(groups[0]).toMatchObject({ hidden: true, locked: true });
  });
});

describe('toggleGroupFlag', () => {
  it('hidden を反転する（undefined→true→false）', () => {
    let groups = [grp('group_001', ['a'])];
    groups = toggleGroupFlag(groups, 'group_001', 'hidden');
    expect(groups[0].hidden).toBe(true);
    groups = toggleGroupFlag(groups, 'group_001', 'hidden');
    expect(groups[0].hidden).toBe(false);
  });
  it('locked を反転し、対象外グループは不変', () => {
    const groups = toggleGroupFlag([grp('group_001', ['a']), grp('group_002', ['b'])], 'group_001', 'locked');
    expect(groups[0].locked).toBe(true);
    expect(groups[1].locked).toBeUndefined();
  });
});

describe('topGroupOfMember', () => {
  it('直接の親グループを返す', () => {
    const groups = [grp('group_001', ['free_001'])];
    expect(topGroupOfMember(groups, 'free_001')?.id).toBe('group_001');
    expect(topGroupOfMember(groups, 'free_999')).toBeNull();
  });
  it('ネストでは最上位グループを返す', () => {
    const groups = [grp('group_001', ['free_001']), grp('group_002', ['group_001'])];
    expect(topGroupOfMember(groups, 'free_001')?.id).toBe('group_002');
  });
});

describe('groupElementIds', () => {
  it('直下の要素 id を返す', () => {
    expect(groupElementIds([grp('group_001', ['free_001', 'free_002'])], 'group_001')).toEqual(['free_001', 'free_002']);
  });
  it('ネストの葉要素を再帰収集する', () => {
    const groups = [grp('group_001', ['free_001']), grp('group_002', ['group_001', 'free_002'])];
    expect(groupElementIds(groups, 'group_002')).toEqual(['free_001', 'free_002']);
  });
});

describe('ungroupGroup', () => {
  it('transform をメンバーへ焼き込み、グループを除去する', () => {
    const freeLayout = [shape('free_001', 100, 100), shape('free_002', 0, 0)];
    const groups = [grp('group_001', ['free_001'], { x: 50, y: -20 })];
    const out = ungroupGroup(groups, freeLayout, 'group_001');
    expect(out.groups).toEqual([]); // グループ除去
    expect(out.elements[0]).toMatchObject({ id: 'free_001', x: 150, y: 80, w: 40, h: 20 }); // 100+50, 100-20
    expect(out.elements[1]).toMatchObject({ id: 'free_002', x: 0, y: 0 }); // 非メンバーは不変
  });
  it('存在しないグループは何もしない', () => {
    const freeLayout = [shape('free_001', 0, 0)];
    const out = ungroupGroup([], freeLayout, 'group_999');
    expect(out.elements).toBe(freeLayout);
  });
  it('回転の焼き込み：合算が 360→0 に正規化される場合は rotation なし（要素30°＋グループ330°）', () => {
    const freeLayout = [{ ...shape('free_001', 100, 100), rotation: 30 }];
    const groups = [grp('group_001', ['free_001'], { rotation: 330 })];
    const out = ungroupGroup(groups, freeLayout, 'group_001');
    expect(out.elements[0].rotation).toBeUndefined(); // 30+330=360 → 0 → 回転なし（el.rotation は残さない）
    expect(out.elements[0]).toMatchObject({ x: 100, y: 100 }); // 単一メンバーは中心不動
  });
  it('回転の焼き込み：合算が非0なら rotation に反映（要素30°＋グループ40°=70°）', () => {
    const freeLayout = [{ ...shape('free_001', 100, 100), rotation: 30 }];
    const groups = [grp('group_001', ['free_001'], { rotation: 40 })];
    const out = ungroupGroup(groups, freeLayout, 'group_001');
    expect(out.elements[0].rotation).toBeCloseTo(70);
  });
});

describe('removeMembersFromGroups', () => {
  it('削除 id を members から除去し、空になったグループは落とす（orphan 防止）', () => {
    const groups = [grp('group_001', ['free_001', 'free_002']), grp('group_002', ['free_003'])];
    const out = removeMembersFromGroups(groups, ['free_002', 'free_003']);
    expect(out).toHaveLength(1); // group_002 は空になり消える
    expect(out[0]).toMatchObject({ id: 'group_001', members: ['free_001'] });
  });
  it('削除対象が空なら元配列をそのまま返す', () => {
    const groups = [grp('group_001', ['free_001'])];
    expect(removeMembersFromGroups(groups, [])).toBe(groups);
  });
});

describe('reorderGroupZ', () => {
  const withZ = (zs: Record<string, number>): FreeElement[] =>
    Object.entries(zs).map(([id, z]) => ({ ...shape(id, 0, 0), zIndex: z }));
  const zOf = (out: FreeElement[], id: string): number | undefined => out.find((e) => e.id === id)?.zIndex;

  it('front：メンバーを非メンバーより上へ（相対順は保つ・1..n に振り直し）', () => {
    const layout = withZ({ free_001: 1, free_002: 2, free_003: 3 }); // 001/003=メンバ, 002=非
    const out = reorderGroupZ(layout, ['free_001', 'free_003'], 'front');
    expect(zOf(out, 'free_002')).toBe(1); // 非メンバが最下
    expect(zOf(out, 'free_001')).toBe(2); // メンバ（001<003 の相対順を保持）
    expect(zOf(out, 'free_003')).toBe(3);
  });
  it('back：メンバーを非メンバーより下へ（1以上＝背景の上）', () => {
    const layout = withZ({ free_001: 1, free_002: 2, free_003: 3 });
    const out = reorderGroupZ(layout, ['free_001', 'free_003'], 'back');
    expect(zOf(out, 'free_001')).toBe(1); // メンバ最下（≥1）
    expect(zOf(out, 'free_003')).toBe(2);
    expect(zOf(out, 'free_002')).toBe(3); // 非メンバが上
  });
  it('メンバーが居なければ元の配列を返す', () => {
    const layout = withZ({ free_001: 1 });
    expect(reorderGroupZ(layout, ['free_999'], 'front')).toBe(layout);
  });
  it('全要素がメンバー（非メンバー0件）→ 相対順を保って 1..n に振り直す', () => {
    const layout = withZ({ free_001: 3, free_002: 1 });
    const out = reorderGroupZ(layout, ['free_001', 'free_002'], 'back');
    expect(zOf(out, 'free_002')).toBe(1); // 元 z1 が下
    expect(zOf(out, 'free_001')).toBe(2); // 元 z3 が上（相対順保持）
  });
});

describe('汎用化：テンプレ Layer 風オブジェクト（rotation なし）でも動く（#307）', () => {
  const lyr = (id: string, x: number, y: number, zIndex = 1) => ({ id, x, y, w: 40, h: 20, zIndex });
  it('ungroupGroup：位置を焼き込み、回転は付かない（undefined）', () => {
    const layers = [lyr('background', 0, 0), lyr('title', 100, 100)];
    const groups = [grp('group_001', ['title'], { x: 50 })];
    const out = ungroupGroup(groups, layers, 'group_001');
    const title = out.elements.find((l) => l.id === 'title') as { x: number; y: number; rotation?: number };
    expect(title).toMatchObject({ x: 150, y: 100 });
    expect(title.rotation).toBeUndefined(); // Layer は回転を持たない（群回転も非対応）
  });
  it('reorderGroupZ：重ね順を振り直す', () => {
    const layers = [lyr('background', 0, 0, 1), lyr('title', 0, 0, 2)];
    const out = reorderGroupZ(layers, ['background'], 'front');
    expect(out.find((l) => l.id === 'title')?.zIndex).toBe(1); // 非メンバ下
    expect(out.find((l) => l.id === 'background')?.zIndex).toBe(2); // メンバ上
  });
});
