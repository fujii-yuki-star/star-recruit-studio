// グループ transform の前合成（ADR-0022・最大の山）。
// 各要素（FreeElement / Layer）の最終 geometry ＝ 所属グループ chain（内→外）の transform を中心まわりに合成して算出する。
// preview / export は layoutScene を共有するため、ここで前合成して LayoutItem に落とせば描画は一致する（ADR-0001）。
//
// 設計（数学）：
// - グループの変形は「グループ中心（メンバー bbox の中心）」まわりに scale → rotate → translate の順で適用。
// - グループ中心は「自グループ transform を適用する前（＝子グループの transform は適用済み）」のメンバー bbox 中心。
//   ネストは boundsOf を再帰させることで内側→外側の順に整合する（親の中心は子変形後の空間で測る）。
// - 要素の最終 geometry は中心・サイズ・回転を厳密に追跡（applyTransform）。bbox（anchor 用）は4隅を写して AABB を取る
//   ため回転・スケール・ネストを正しく展開する（transformRectAABB）。回転は中心を不変に保つので AABB 中心＝変形後中心。
import type { Group, GroupTransform } from './types';

/** 配置矩形＋回転（要素／レイヤーの幾何）。 */
export interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 回転角（度・中心まわり・時計回り）。未指定＝0。 */
  rotation?: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const deg2rad = (d: number): number => (d * Math.PI) / 180;

/** 点 (px,py) を anchor まわりに deg 度（時計回り）回転。 */
function rotateAround(ax: number, ay: number, px: number, py: number, deg: number): [number, number] {
  if (!deg) return [px, py];
  const r = deg2rad(deg);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = px - ax;
  const dy = py - ay;
  return [ax + dx * cos - dy * sin, ay + dx * sin + dy * cos];
}

/** 点を transform（anchor まわり scale → rotate → translate）で写す。 */
function transformPoint(t: GroupTransform, ax: number, ay: number, px: number, py: number): [number, number] {
  let x = ax + (px - ax) * t.scale;
  let y = ay + (py - ay) * t.scale;
  [x, y] = rotateAround(ax, ay, x, y, t.rotation);
  return [x + t.x, y + t.y];
}

function aabbOfPoints(pts: Array<[number, number]>): Rect {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

const cornersOf = (r: Rect): Array<[number, number]> => [
  [r.x, r.y],
  [r.x + r.w, r.y],
  [r.x, r.y + r.h],
  [r.x + r.w, r.y + r.h],
];

/** 軸並行矩形を transform で写したときの AABB（4隅を写して包む）。 */
function transformRectAABB(t: GroupTransform, ax: number, ay: number, r: Rect): Rect {
  return aabbOfPoints(cornersOf(r).map(([px, py]) => transformPoint(t, ax, ay, px, py)));
}

/** 中心まわりに deg 回転した矩形の AABB（要素の見た目の範囲）。 */
function rotatedRectAABB(r: Rect, deg: number): Rect {
  if (!deg) return r;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return aabbOfPoints(cornersOf(r).map(([px, py]) => rotateAround(cx, cy, px, py, deg)));
}

function unionRects(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const EMPTY_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** 要素の最終 geometry：transform を中心まわり scale → rotate → translate で適用。 */
function applyTransform(t: GroupTransform, ax: number, ay: number, geom: Geom): Geom {
  const cx0 = geom.x + geom.w / 2;
  const cy0 = geom.y + geom.h / 2;
  const w = geom.w * t.scale;
  const h = geom.h * t.scale;
  let cx = ax + (cx0 - ax) * t.scale;
  let cy = ay + (cy0 - ay) * t.scale;
  [cx, cy] = rotateAround(ax, ay, cx, cy, t.rotation);
  cx += t.x;
  cy += t.y;
  return { x: cx - w / 2, y: cy - h / 2, w, h, rotation: (geom.rotation ?? 0) + t.rotation };
}

/**
 * 各要素の最終 geometry を算出する（グループ未所属はそのまま）。
 * @param elements 要素／レイヤーの幾何（id 一意）。
 * @param groups   scene.groups / template.groups。
 * @returns id → 合成後 geometry（全 elements 分。未所属は入力と同値）。
 */
export function composeGroupGeometry(
  elements: ReadonlyArray<{ id: string } & Geom>,
  groups: ReadonlyArray<Group>,
): Map<string, Geom> {
  const result = new Map<string, Geom>();
  if (groups.length === 0) {
    for (const el of elements) result.set(el.id, { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation });
    return result;
  }

  const elemById = new Map(elements.map((e) => [e.id, e] as const));
  const groupById = new Map(groups.map((g) => [g.id, g] as const));

  // メンバー → 親グループ（最大1。重複指定は先勝ち）。
  const parentOf = new Map<string, string>();
  for (const g of groups) {
    for (const m of g.members) if (!parentOf.has(m)) parentOf.set(m, g.id);
  }

  // ノード（要素 or グループ）の AABB を、自身＋子孫の transform 適用後・祖先未適用の空間で返す。visiting で循環ガード。
  function boundsOf(nodeId: string, visiting: Set<string>): Rect {
    const g = groupById.get(nodeId);
    if (!g) {
      // members に存在しない id（要素でもグループでもない）は空矩形＝サイレント無視（堅牢性優先）。
      // 不正メンバー参照の検証（V_group）は #308 で 11 §8（V20）に追補済（不在は描画で無視＋削除経路で除去）。
      const el = elemById.get(nodeId);
      return el ? rotatedRectAABB({ x: el.x, y: el.y, w: el.w, h: el.h }, el.rotation ?? 0) : EMPTY_RECT;
    }
    if (visiting.has(nodeId)) return EMPTY_RECT; // 循環は無視
    visiting.add(nodeId);
    const childBounds = g.members.map((m) => boundsOf(m, visiting));
    visiting.delete(nodeId);
    if (childBounds.length === 0) return EMPTY_RECT;
    const u = unionRects(childBounds);
    const ax = u.x + u.w / 2;
    const ay = u.y + u.h / 2;
    return unionRects(childBounds.map((b) => transformRectAABB(g.transform, ax, ay, b)));
  }

  /** グループ中心（メンバー bbox の中心・自 transform 前）。 */
  function anchorOf(g: Group): [number, number] {
    const childBounds = g.members.map((m) => boundsOf(m, new Set<string>()));
    const u = unionRects(childBounds.length ? childBounds : [EMPTY_RECT]);
    return [u.x + u.w / 2, u.y + u.h / 2];
  }

  for (const el of elements) {
    let geom: Geom = { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation };
    // 祖先グループ chain（内→外）。seen で循環ガード。
    const chain: Group[] = [];
    const seen = new Set<string>();
    for (let cur = parentOf.get(el.id); cur && !seen.has(cur); cur = parentOf.get(cur)) {
      seen.add(cur);
      const g = groupById.get(cur);
      if (!g) break;
      chain.push(g);
    }
    for (const g of chain) {
      const [ax, ay] = anchorOf(g);
      geom = applyTransform(g.transform, ax, ay, geom);
    }
    result.set(el.id, geom);
  }
  return result;
}

/** グループ chain 上に hidden なグループがあるか（描画抑止用）。循環ガード付き。 */
export function isHiddenByGroup(memberId: string, groups: ReadonlyArray<Group>): boolean {
  if (groups.length === 0) return false;
  const groupById = new Map(groups.map((g) => [g.id, g] as const));
  const parentOf = new Map<string, string>();
  for (const g of groups) for (const m of g.members) if (!parentOf.has(m)) parentOf.set(m, g.id);
  const seen = new Set<string>();
  for (let cur = parentOf.get(memberId); cur && !seen.has(cur); cur = parentOf.get(cur)) {
    seen.add(cur);
    if (groupById.get(cur)?.hidden) return true;
  }
  return false;
}

/**
 * グループ自身または祖先グループが非表示か（ネスト対応）。非表示グループの操作枠（選択枠/ハンドル）を出さない判定に使う
 * （描画されないグループを操作可能にしない・#525-9 レビュー）。isHiddenByGroup は祖先のみを見るため、自身の hidden を足す。
 */
export function isGroupHidden(groupId: string, groups: ReadonlyArray<Group>): boolean {
  return groups.find((g) => g.id === groupId)?.hidden === true || isHiddenByGroup(groupId, groups);
}

/** グループの「向き付き枠」（選択枠・拡縮/回転の pivot 用）。 */
export interface OrientedFrame {
  /** 枠の中心（canvas 座標）＝グループ変形の pivot。 */
  cx: number;
  cy: number;
  /** 枠のサイズ（scale 適用後）。 */
  w: number;
  h: number;
  /** 枠の回転（度・group transform の rotation）。 */
  rotation: number;
}

/**
 * グループの向き付き枠を、**composeGroupGeometry と同じ anchor（メンバーの回転後 AABB 基準）**で算出する。
 * メンバーの回転後 AABB を包む local bbox にグループ transform を適用：中心＝anchor＋平行移動／サイズ＝local×scale／
 * 回転＝rotation。旧実装は素の x/y/w/h（軸平行）で bbox を取っていたため、回転メンバーを含むグループで枠中心＝
 * 拡縮/回転 pivot が実描画とずれていた（#312 既知制限）。これを解消し overlay と描画で pivot を一致させる（#525-10）。
 * flat 前提（members＝要素/レイヤー id・不在メンバーは無視）。回転メンバーが無ければ従来と同値（後方互換）。
 * @returns 枠（メンバーが1つも無ければ null）。
 */
export function orientedGroupFrame(
  group: Group,
  elements: ReadonlyArray<{ id: string } & Geom>,
): OrientedFrame | null {
  const byId = new Map(elements.map((e) => [e.id, e] as const));
  const aabbs = group.members
    .map((id) => byId.get(id))
    .filter((e): e is { id: string } & Geom => e != null)
    .map((e) => rotatedRectAABB({ x: e.x, y: e.y, w: e.w, h: e.h }, e.rotation ?? 0));
  if (aabbs.length === 0) return null;
  const u = unionRects(aabbs);
  const t = group.transform;
  return {
    cx: u.x + u.w / 2 + t.x,
    cy: u.y + u.h / 2 + t.y,
    w: u.w * t.scale,
    h: u.h * t.scale,
    rotation: t.rotation,
  };
}
