// 要素のグループ化（ADR-0022）の編集 ops（FREE＝scene.groups + freeLayout 対象）。純粋関数（副作用なし）。
// store は updateScene 経由でこれらを呼び、結果で scene.groups / freeLayout を差し替える。
// グループ操作は「グループ自身の transform を更新」する（メンバー座標は保持）。ungroup 時のみ transform をメンバーへ焼き込む。
import { composeGroupGeometry } from '../group/compose';
import type { Group, GroupTransform } from '../group/types';
import { createGroupId } from './persistence';
import type { FreeElement } from './types';

/** identity 変形（新規グループの初期値）。 */
export const IDENTITY_TRANSFORM: GroupTransform = { x: 0, y: 0, rotation: 0, scale: 1 };

const normalizeDeg = (d: number): number => ((d % 360) + 360) % 360;

/** 選択中の id をメンバーにした新しいグループ（identity transform）を末尾に追加し、新 group id を返す。 */
export function createGroupFromSelection(
  groups: Group[], memberIds: string[],
): { groups: Group[]; groupId: string } {
  const groupId = createGroupId(groups.map((g) => g.id));
  const group: Group = { id: groupId, members: [...memberIds], transform: { ...IDENTITY_TRANSFORM } };
  return { groups: [...groups, group], groupId };
}

/** グループの transform を patch で更新（指定フィールドを置換）。 */
export function updateGroupTransform(
  groups: Group[], groupId: string, patch: Partial<GroupTransform>,
): Group[] {
  return groups.map((g) => (g.id === groupId ? { ...g, transform: { ...g.transform, ...patch } } : g));
}

/** グループのメタ（name/zIndex/hidden/locked）を更新。 */
export function updateGroupMeta(
  groups: Group[], groupId: string, patch: Partial<Pick<Group, 'name' | 'zIndex' | 'hidden' | 'locked'>>,
): Group[] {
  return groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g));
}

/** メンバー id を含む最上位グループ（ネストの親まで辿る）。クリックで「グループごと選択」するため。循環ガード付き。 */
export function topGroupOfMember(groups: Group[], memberId: string): Group | null {
  const parentOf = new Map<string, string>();
  for (const g of groups) for (const m of g.members) if (!parentOf.has(m)) parentOf.set(m, g.id);
  const byId = new Map(groups.map((g) => [g.id, g] as const));
  const seen = new Set<string>();
  let top: Group | null = null;
  for (let cur = parentOf.get(memberId); cur && !seen.has(cur); cur = parentOf.get(cur)) {
    seen.add(cur);
    top = byId.get(cur) ?? top;
  }
  return top;
}

/** グループ配下の葉（要素）id を再帰収集（ネスト対応・循環ガード）。 */
export function groupElementIds(groups: Group[], groupId: string): string[] {
  const byId = new Map(groups.map((g) => [g.id, g] as const));
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string): void => {
    const g = byId.get(id);
    if (!g) { out.push(id); return; } // グループでない＝要素 id
    if (seen.has(id)) return; // 循環ガード
    seen.add(id);
    for (const m of g.members) walk(m);
  };
  const root = byId.get(groupId);
  if (root) for (const m of root.members) walk(m);
  return out;
}

/** グループを解除し、transform をメンバー要素へ焼き込む（ADR-0022・flat 前提＝#305-1）。 */
export function ungroupGroup(
  groups: Group[], freeLayout: FreeElement[], groupId: string,
): { groups: Group[]; freeLayout: FreeElement[] } {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return { groups, freeLayout };
  const memberIds = new Set(groupElementIds(groups, groupId));
  const composed = composeGroupGeometry(freeLayout, [group]); // このグループだけ適用して焼き込む
  const freeLayoutBaked = freeLayout.map((el) => {
    if (!memberIds.has(el.id)) return el;
    const g = composed.get(el.id);
    if (!g) return el;
    // 合成後の回転（要素＋グループ回転の合算）をそのまま採用。0（=回転なし）のときは undefined にして明示する。
    // ※ el.rotation を残すと、合算が 360→0 に正規化される場合（例 要素30°＋グループ330°）に焼き込み前後で表示がズレる。
    const rot = normalizeDeg(g.rotation ?? 0);
    return { ...el, x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h), rotation: rot === 0 ? undefined : rot };
  });
  return { groups: groups.filter((g) => g.id !== groupId), freeLayout: freeLayoutBaked };
}

/** 要素削除に伴い、groups から該当 id を除去し、空になったグループを落とす（orphan 参照の防止・flat 前提＝#305-1）。 */
export function removeMembersFromGroups(groups: Group[], removedIds: string[]): Group[] {
  if (groups.length === 0 || removedIds.length === 0) return groups;
  const removed = new Set(removedIds);
  return groups
    .map((g) => ({ ...g, members: g.members.filter((m) => !removed.has(m)) }))
    .filter((g) => g.members.length > 0);
}
