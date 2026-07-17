// 要素のグループ化（ADR-0022）の編集 ops（FREE 要素 / テンプレ Layer 共用＝<T> で汎用化）。純粋関数（副作用なし）。
// 呼び出し側（store/エディタ）が結果で groups と要素配列（FREE=scene.freeLayout / テンプレ=template.layers）を差し替える。
// グループ操作は「グループ自身の transform を更新」する（メンバー座標は保持）。ungroup 時のみ transform をメンバーへ焼き込む。
import { composeGroupGeometry } from '../group/compose';
import type { Group, GroupTransform } from '../group/types';
import { createGroupId } from './persistence';

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

/** グループの hidden/locked を反転する（UI トグル用）。現在値の否定を updateGroupMeta に委譲。 */
export function toggleGroupFlag(groups: Group[], groupId: string, flag: 'hidden' | 'locked'): Group[] {
  const cur = groups.find((g) => g.id === groupId);
  return updateGroupMeta(groups, groupId, { [flag]: !cur?.[flag] });
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

/**
 * グループをメンバーごと削除するための分解（#551）。**要素は消さず**「消すべき要素 id」と「残る groups」を返す純粋関数
 * （実際の要素削除は呼び出し側＝FREE は `removeFreeElements`／テンプレは `removeLayer` が行う＝要素の型に依存しない）。
 *
 * - **消す要素**＝`groupElementIds`（推移的＝ネストした子グループの中身も含む）。
 * - **消えるグループ**（`groupIds`）＝対象＋子孫＋「空になって落ちた親」。**グループ自体もアニメの対象になりうる**
 *   （ADR-0019 ④(3)）ため、呼び出し側が孤児アニメを掃除するのに要る。
 * - **残る groups**＝上記を除き、親の members からも参照を外す。さらに members が空になったグループを**安定するまで**
 *   落とす（子を失った親が空グループとして残る／消えた親を孫が参照する、を防ぐ）。
 *   `removeMembersFromGroups`（flat 前提・1パス）と違い、`groupElementIds` が対応しているネストをここでも扱う。
 */
export function removeGroupWithMembers(
  groups: Group[],
  groupId: string,
): { elementIds: string[]; groupIds: string[]; groups: Group[] } {
  if (!groups.some((g) => g.id === groupId)) return { elementIds: [], groupIds: [], groups };
  const elementIds = groupElementIds(groups, groupId);
  // 対象＋子孫グループの id（循環ガードつき）。
  const byId = new Map(groups.map((g) => [g.id, g] as const));
  const gone = new Set<string>();
  const walk = (id: string): void => {
    const g = byId.get(id);
    if (!g || gone.has(id)) return;
    gone.add(id);
    for (const m of g.members) walk(m);
  };
  walk(groupId);
  let next = groups
    .filter((g) => !gone.has(g.id))
    .map((g) => ({ ...g, members: g.members.filter((m) => !gone.has(m)) }));
  // 空になったグループを落とし、その参照も外す。これで新たに空になる親がありうるので安定するまで繰り返す。
  for (;;) {
    const empty = next.filter((g) => g.members.length === 0).map((g) => g.id);
    if (empty.length === 0) break;
    for (const id of empty) gone.add(id); // 落ちた親もアニメ掃除の対象へ
    const dropped = new Set(empty);
    next = next
      .filter((g) => !dropped.has(g.id))
      .map((g) => ({ ...g, members: g.members.filter((m) => !dropped.has(m)) }));
  }
  return { elementIds, groupIds: [...gone], groups: next };
}

/**
 * グループを解除し、transform をメンバー（FREE 要素 / テンプレ Layer）へ焼き込む（ADR-0022・flat 前提）。
 * T で汎用化＝FREE と テンプレで共用。返り値の要素キーは `elements`。
 */
export function ungroupGroup<T extends { id: string; x: number; y: number; w: number; h: number; rotation?: number }>(
  groups: Group[], elements: T[], groupId: string,
): { groups: Group[]; elements: T[] } {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return { groups, elements };
  const memberIds = new Set(groupElementIds(groups, groupId));
  const composed = composeGroupGeometry(elements, [group]); // このグループだけ適用して焼き込む
  const elementsBaked = elements.map((el) => {
    if (!memberIds.has(el.id)) return el;
    const g = composed.get(el.id);
    if (!g) return el;
    // 合成後の回転（要素＋グループ回転の合算）。0（=回転なし）は undefined にして明示（el.rotation を残すと 360→0 正規化でズレる）。
    // ※ テンプレ Layer は rotation を持たず群回転も非対応ゆえ常に 0→undefined（JSON では省略される）。
    const rot = normalizeDeg(g.rotation ?? 0);
    return { ...el, x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h), rotation: rot === 0 ? undefined : rot };
  });
  return { groups: groups.filter((g) => g.id !== groupId), elements: elementsBaked };
}

/** 要素削除に伴い、groups から該当 id を除去し、空になったグループを落とす（orphan 参照の防止・flat 前提＝#305-1）。 */
export function removeMembersFromGroups(groups: Group[], removedIds: string[]): Group[] {
  if (groups.length === 0 || removedIds.length === 0) return groups;
  const removed = new Set(removedIds);
  return groups
    .map((g) => ({ ...g, members: g.members.filter((m) => !removed.has(m)) }))
    .filter((g) => g.members.length > 0);
}

/**
 * グループのメンバー全体を最前面('front')/最背面('back')へ動かす（重ね順・ADR-0022）。
 * 非メンバー・メンバーそれぞれの相対順は保ち、全要素の zIndex を 1..n に振り直す（FREE 背景 zIndex 0 の上に乗せる）。
 */
export function reorderGroupZ<T extends { id: string; zIndex?: number }>(
  elements: T[], memberIds: string[], position: 'front' | 'back',
): T[] {
  const members = new Set(memberIds);
  const byZ = (a: T, b: T): number => (a.zIndex ?? 1) - (b.zIndex ?? 1);
  const mem = elements.filter((e) => members.has(e.id)).sort(byZ);
  if (mem.length === 0) return elements;
  const oth = elements.filter((e) => !members.has(e.id)).sort(byZ);
  const order = position === 'front' ? [...oth, ...mem] : [...mem, ...oth];
  const zById = new Map(order.map((e, i) => [e.id, i + 1] as const));
  return elements.map((e) => ({ ...e, zIndex: zById.get(e.id) ?? (e.zIndex ?? 1) }));
}
