// FREE テンプレ場面の自由配置（scene.freeLayout）への要素の追加・更新・削除（ADR-0008・Phase 4a-3b）。
// 純粋関数（副作用なし）。store は updateScene 経由でこれらを呼び、結果の配列で freeLayout を差し替える。
// ID 採番は createFreeElementId（§2.1・scene 内一意）に委譲する。
import { DEFAULT_FIT, GEOM_MIN_SIZE } from '../constants';
import { FONT_WEIGHT, FREE_ELEMENT_KIND, FREE_SHAPE_TYPE, TEXT_ALIGN } from '../enums';
import type { FreeElementKind } from '../enums';
import { composeGroupGeometry } from '../group/compose';
import type { Group } from '../group/types';
import { DEFAULT_TEXT_COLOR } from '../template/textStyle';
import { createFreeElementId } from './persistence';
import type { FreeElement } from './types';
import { moveByZ } from '../zOrder';

// 新規要素の既定の配置・大きさ・体裁（canvas 1920×1080 基準の見やすい初期値。描画の fallback とは別の編集用既定）。
const DEFAULT_X = 200;
const DEFAULT_Y = 200;
const DEFAULT_SLOT_W = 800;
const DEFAULT_SLOT_H = 540;
const DEFAULT_TEXT_W = 800;
const DEFAULT_TEXT_H = 160;
const DEFAULT_TEXT_FONT_SIZE = 48;
const DEFAULT_SHAPE_W = 600;
const DEFAULT_SHAPE_H = 400;
const DEFAULT_TEXT = 'テキスト';
const DEFAULT_SHAPE_COLOR = '#cccccc';
// 字幕要素（ADR-0029）：画面下寄りの字幕バー。表示文言は subtitleSource（対象）から解決＝el.text は持たない。
const DEFAULT_SUBTITLE_X = 240;
const DEFAULT_SUBTITLE_Y = 900;
const DEFAULT_SUBTITLE_W = 1440;
const DEFAULT_SUBTITLE_H = 120;
const DEFAULT_SUBTITLE_FONT_SIZE = 52;
const DEFAULT_SUBTITLE_COLOR = '#ffffff';
const DEFAULT_SUBTITLE_STROKE = '#000000';
const DEFAULT_SUBTITLE_STROKE_WIDTH = 6;
// 上の既定値は横型 canvas（1920×1080）で見やすいよう調整した基準。実 canvas に合わせて比例縮尺し、
// 縦型（1080×1920）でも要素が画面幅いっぱいで中央に寄って見える等の違和感を防ぐ（#273）。横型では係数1＝従来どおり。
export const REF_CANVAS_W = 1920;
export const REF_CANVAS_H = 1080;

/** 新しい要素を1つ生成する（id は scene 内一意・zIndex は既存の最前面+1 で最前面に置く）。canvas 比で既定の位置/大きさをスケール（#273）。 */
export function createFreeElement(
  freeLayout: FreeElement[], kind: FreeElementKind, canvasW: number = REF_CANVAS_W, canvasH: number = REF_CANVAS_H,
): FreeElement {
  const id = createFreeElementId(freeLayout.map((e) => e.id));
  const zIndex = freeLayout.reduce((max, e) => Math.max(max, e.zIndex ?? 0), 0) + 1;
  // x/幅は canvasW、y/高さは canvasH を基準にスケール（横型 1920×1080 は係数1）。整数 px に丸める。
  const sx = (v: number): number => Math.round((v * canvasW) / REF_CANVAS_W);
  const sy = (v: number): number => Math.round((v * canvasH) / REF_CANVAS_H);
  const base = { id, x: sx(DEFAULT_X), y: sy(DEFAULT_Y), zIndex };
  switch (kind) {
    case FREE_ELEMENT_KIND.slot:
      return { ...base, kind, w: sx(DEFAULT_SLOT_W), h: sy(DEFAULT_SLOT_H), assetId: null, fit: DEFAULT_FIT };
    case FREE_ELEMENT_KIND.text:
      return {
        // fontSize も幅(sx)基準でスケール＝文字と枠の比率を縦横で一定に保つ（縦型で初期文字が大きすぎない・PR#280レビュー）。
        ...base, kind, w: sx(DEFAULT_TEXT_W), h: sy(DEFAULT_TEXT_H),
        text: DEFAULT_TEXT, fontSize: sx(DEFAULT_TEXT_FONT_SIZE), color: DEFAULT_TEXT_COLOR, fontWeight: FONT_WEIGHT.normal,
      };
    case FREE_ELEMENT_KIND.shape:
      return {
        ...base, kind, w: sx(DEFAULT_SHAPE_W), h: sy(DEFAULT_SHAPE_H),
        shapeType: FREE_SHAPE_TYPE.rect, fillColor: DEFAULT_SHAPE_COLOR, opacity: 1, radius: 0,
      };
    case FREE_ELEMENT_KIND.subtitle:
      // 字幕バー（白文字＋黒縁で可読性）。文言は subtitleSource から解決＝el.text は持たない（ADR-0029）。
      // subtitleSource 未指定＝後方互換（単独→読み上げ・掛け合い→全行）。対象の選択は場面編集 UI（PR-C）で。
      return {
        ...base, kind, x: sx(DEFAULT_SUBTITLE_X), y: sy(DEFAULT_SUBTITLE_Y), w: sx(DEFAULT_SUBTITLE_W), h: sy(DEFAULT_SUBTITLE_H),
        fontSize: sx(DEFAULT_SUBTITLE_FONT_SIZE), color: DEFAULT_SUBTITLE_COLOR, fontWeight: FONT_WEIGHT.bold,
        textAlign: TEXT_ALIGN.center, strokeColor: DEFAULT_SUBTITLE_STROKE, strokeWidth: DEFAULT_SUBTITLE_STROKE_WIDTH,
      };
    default: {
      // FreeElementKind を網羅していることを型で保証する（kind 追加時はコンパイルエラー）。
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * 指定 kind の新規要素を末尾に追加した配列と、新要素の id を返す。
 * UI はこの newId で追加直後の要素を選択状態にできる（duplicateFreeElement と同形・#179）。
 */
export function addFreeElement(
  freeLayout: FreeElement[], kind: FreeElementKind, canvasW: number = REF_CANVAS_W, canvasH: number = REF_CANVAS_H,
): { freeLayout: FreeElement[]; newId: string } {
  const el = createFreeElement(freeLayout, kind, canvasW, canvasH);
  return { freeLayout: [...freeLayout, el], newId: el.id };
}

/**
 * 指定 id の要素に patch を当てた配列を返す（id が無ければ変化なし）。kind は変更しない。
 * FreeElement は flat interface（全 kind のフィールドが optional）のため patch 型は kind 横断
 * フィールドを型で禁じないが、描画（renderer は el.kind 基準）・検証（validateFreeLayout）とも
 * kind に無関係なフィールドは無視するため実害はない。UI も kind 別フォームで整合する patch のみ送る。
 */
export function updateFreeElement(
  freeLayout: FreeElement[], id: string, patch: Partial<Omit<FreeElement, 'id' | 'kind'>>,
): FreeElement[] {
  return freeLayout.map((e) => (e.id === id ? { ...e, ...patch } : e));
}

/** 指定 id の要素を取り除いた配列を返す。 */
export function removeFreeElement(freeLayout: FreeElement[], id: string): FreeElement[] {
  return freeLayout.filter((e) => e.id !== id);
}

/**
 * 点（canvas 座標）が要素の矩形の中か。**回転を考慮**する＝点を要素中心まわりに -rotation 回して軸平行で判定
 * （描画は中心軸で回すため・#208 と同じ基準）。rotation 未指定＝0。
 */
export function pointInElement(
  el: { x: number; y: number; w: number; h: number; rotation?: number },
  point: { x: number; y: number },
): boolean {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const rad = (-(el.rotation ?? 0) * Math.PI) / 180;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad); // 要素ローカル座標へ戻す
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) <= el.w / 2 && Math.abs(ly) <= el.h / 2;
}

/**
 * 点に当たる**最前面**の要素 id を返す（無ければ null）。`items` は**描画順（奥→手前）**で渡す＝
 * 最後に当たったものが最前面（layout.ts が zIndex 昇順で描くのと同じ並び。同 zIndex は後勝ち）。
 *
 * 用途＝グループ枠が内部クリックを貪欲に食わないようにするヒットテスト（#548/#552）。枠は不透明で
 * グループの外接矩形**全域**を覆うため、枠の pointerdown で「ポインタの下に実際は何があるか」を
 * 判定して分岐する（メンバー／グループ外の要素／空白）。呼び出し側で非表示・合成後座標を解決して渡す。
 */
// 構造型で受ける＝FreeElement だけでなくテンプレの Layer にも流用（ADR-0017・#306）。
export function elementAtPoint(
  items: ReadonlyArray<{ id: string; x: number; y: number; w: number; h: number; rotation?: number }>,
  point: { x: number; y: number },
): string | null {
  let hit: string | null = null;
  for (const el of items) if (pointInElement(el, point)) hit = el.id; // 後ほど＝手前
  return hit;
}

/**
 * 範囲選択（マーキー・#274）：矩形（canvas 座標・2点は順不同）と AABB が交差する要素の id を返す。
 * 非表示・ロック中の要素は対象外＝一括操作に巻き込まない（非表示は触れない・ロックは固定）。
 */
// 構造型で受ける＝FreeElement だけでなくテンプレの Layer（hidden/locked 無し）にも流用（ADR-0017・#306）。
export function freeElementsInRect(
  items: ReadonlyArray<{ id: string; x: number; y: number; w: number; h: number; hidden?: boolean; locked?: boolean }>,
  rect: { x0: number; y0: number; x1: number; y1: number },
): string[] {
  const left = Math.min(rect.x0, rect.x1);
  const right = Math.max(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const bottom = Math.max(rect.y0, rect.y1);
  return items
    .filter((el) => !el.hidden && !el.locked)
    .filter((el) => el.x < right && el.x + el.w > left && el.y < bottom && el.y + el.h > top)
    .map((el) => el.id);
}

// ── 複数選択の一括操作（移動・削除）。純粋関数＝§7 テスト対象。 ──

/** 一括移動・整列・分布で使う位置更新（要素 id と新しい x,y）。生成側（freeAlign 等）と適用側で共有する型。 */
export interface FreeElementMove {
  id: string;
  x: number;
  y: number;
}

/** 複数同時リサイズ（#274）で使う位置・大きさ更新（要素 id と新しい x,y,w,h）。 */
export interface FreeElementGeom {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 複数要素の位置(x,y)をまとめて設定する（複数選択の一括移動）。moves に無い要素は不変・空なら同一参照を返す。 */
export function applyFreeElementPositions(
  freeLayout: FreeElement[], moves: FreeElementMove[],
): FreeElement[] {
  if (moves.length === 0) return freeLayout;
  const byId = new Map(moves.map((m) => [m.id, m]));
  return freeLayout.map((el) => {
    const m = byId.get(el.id);
    return m ? { ...el, x: m.x, y: m.y } : el;
  });
}

/**
 * キーボード微調整（#525-11）：選択中の非ロック要素を**画面上 dx,dy** だけずらす移動リスト。
 * ロック要素は動かさない（レイヤー一覧のロックと一貫・#210）。存在しない id は無視。applyFreeElementPositions と併用。
 *
 * 未所属・純並進グループのメンバー（合成後 w・rotation が素と一致）は base==画面ゆえ **base デルタ＝画面デルタ で厳密 1:1**。
 * **拡縮/回転グループのメンバーは対象外**（＝#542 の canvas select-only と一貫・詳細パネルで編集）。理由：描画は
 * composeGroupGeometry で anch（メンバー境界の中心）まわりに拡縮/回転するが、その anchor は base を動かすと再計算で
 * ドリフトするため base→画面の写像が一意な線形逆変換にならない（内部メンバーは scale·R だが単一/縁メンバーは係数が変わり、
 * 単一回転では逆方向になる）。よって「画面 1:1 で動かす」保証ができるのは純並進/未所属に限り、変形メンバーは動かさない
 * （壊れて見える近似移動を出さない・ADR-0026／#525-11 レビュー P2）。混在選択でも未所属だけが 1:1 で動き、変形メンバーは据え置き。
 */
export function nudgeFreeElements(
  freeLayout: FreeElement[], groups: ReadonlyArray<Group>, ids: ReadonlyArray<string>, dx: number, dy: number,
): FreeElementMove[] {
  const sel = new Set(ids);
  const composed = groups.length > 0 ? composeGroupGeometry(freeLayout, groups) : null;
  return freeLayout
    .filter((el) => sel.has(el.id) && !el.locked)
    .filter((el) => {
      const cg = composed?.get(el.id);
      return !cg || (cg.w === el.w && (cg.rotation ?? 0) === (el.rotation ?? 0)); // 未所属 or 純並進のみ（変形メンバーは select-only）
    })
    .map((el) => ({ id: el.id, x: el.x + dx, y: el.y + dy }));
}

/** キーボードの矢印キー → 移動量（px・#525-11）。Shift で 10px、通常 1px。矢印以外は null。 */
export function keyboardNudgeDelta(key: string, shiftKey: boolean): { dx: number; dy: number } | null {
  const step = shiftKey ? 10 : 1;
  switch (key) {
    case 'ArrowLeft': return { dx: -step, dy: 0 };
    case 'ArrowRight': return { dx: step, dy: 0 };
    case 'ArrowUp': return { dx: 0, dy: -step };
    case 'ArrowDown': return { dx: 0, dy: step };
    default: return null;
  }
}

/**
 * 要素の見た目（回転後）の AABB（canvas 座標）。rotation 未指定/0 は素の x/y/w/h に一致。
 * 中心まわり回転の閉形式（vw=w·|cosθ|+h·|sinθ|／vh=w·|sinθ|+h·|cosθ|）。回転は中心を不変に保つ。
 * 複数同時リサイズのグループ枠(#300(a))が回転要素も囲めるようにするための基準。
 */
export function elementVisualBBox(
  el: { x: number; y: number; w: number; h: number; rotation?: number },
): Geom {
  const rot = el.rotation ?? 0;
  if (rot === 0) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const rad = (rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const vw = el.w * c + el.h * s;
  const vh = el.w * s + el.h * c;
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  return { x: cx - vw / 2, y: cy - vh / 2, w: vw, h: vh };
}

/**
 * 複数要素を囲む最小の矩形（バウンディングボックス）。空なら null（複数同時リサイズ・#274）。
 * 各要素は**見た目（回転後）の AABB**（elementVisualBBox）で囲む＝回転要素も枠に収まる（#300(a)）。回転なしは素の矩形。
 */
export function groupBBox(elements: FreeElement[]): Geom | null {
  if (elements.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const b = elementVisualBBox(el);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 複数同時リサイズ（#274）：グループ bbox を oldBBox→newBBox に変えたとき、各要素の bbox 内の相対位置・
 * 大きさを保ったままスケールする。各要素は FREE_MIN_SIZE 以上にクランプ。oldBBox が 0 幅/高なら等倍。
 */
export function resizeGroup(
  elements: FreeElement[], oldBBox: Geom, newBBox: Geom,
): FreeElementGeom[] {
  const sx = oldBBox.w > 0 ? newBBox.w / oldBBox.w : 1;
  const sy = oldBBox.h > 0 ? newBBox.h / oldBBox.h : 1;
  return elements.map((el) => ({
    id: el.id,
    x: Math.round(newBBox.x + (el.x - oldBBox.x) * sx),
    y: Math.round(newBBox.y + (el.y - oldBBox.y) * sy),
    w: Math.max(FREE_MIN_SIZE, Math.round(el.w * sx)),
    h: Math.max(FREE_MIN_SIZE, Math.round(el.h * sy)),
  }));
}

/** 複数要素の位置・大きさ(x,y,w,h)をまとめて設定する（複数同時リサイズの適用）。updates に無い要素は不変・空なら同一参照。 */
export function applyFreeElementGeoms(
  freeLayout: FreeElement[], updates: FreeElementGeom[],
): FreeElement[] {
  if (updates.length === 0) return freeLayout;
  const byId = new Map(updates.map((u) => [u.id, u]));
  return freeLayout.map((el) => {
    const u = byId.get(el.id);
    return u ? { ...el, x: u.x, y: u.y, w: u.w, h: u.h } : el;
  });
}

/**
 * 回転ハンドルのドラッグ（#279）：要素中心からポインタへの角度を整数の度で返す（0≤r<360）。
 * 上(12時)を 0°、時計回りに増加（CSS rotate / 出力 SVG の rotate と同じ向き）。center/pointer は同一座標系。
 */
export function rotationFromPointer(
  center: { x: number; y: number }, pointer: { x: number; y: number },
): number {
  const deg = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
  return (((Math.round(deg) % 360) + 360) % 360);
}

/** 角度を step 度きざみにスナップして 0≤r<360 に正規化（#279・Shift で 15° 吸着など）。step<=0 は正規化のみ。 */
export function snapAngle(deg: number, step: number): number {
  const snapped = step > 0 ? Math.round(deg / step) * step : deg;
  return (((snapped % 360) + 360) % 360);
}

/** 複数 id の要素をまとめて削除する（複数選択の一括削除）。空なら同一参照を返す。 */
export function removeFreeElements(freeLayout: FreeElement[], ids: string[]): FreeElement[] {
  if (ids.length === 0) return freeLayout;
  const set = new Set(ids);
  return freeLayout.filter((e) => !set.has(e.id));
}

// ── 複製・重なり順（前面/背面）。純粋関数＝§7 テスト対象。 ──

/** 複製コピーを元から少しずらす量（canvas px・完全に重なって見つけられなくならないように）。 */
const FREE_DUPLICATE_OFFSET = 20;

/**
 * 要素を freeLayout に貼り付ける（新 id を採番し、元から少しずらして最前面に置く）。コピー&ペースト（場面間も可）に使う。
 * element は任意の FreeElement（別場面からコピーしたものでもよい）。返り値の newId で貼付直後の要素を選択状態にできる。
 */
export function pasteFreeElement(
  freeLayout: FreeElement[], element: FreeElement,
): { freeLayout: FreeElement[]; newId: string } {
  const newId = createFreeElementId(freeLayout.map((e) => e.id));
  const zIndex = freeLayout.reduce((max, e) => Math.max(max, e.zIndex ?? 0), 0) + 1;
  const copy: FreeElement = {
    ...element,
    id: newId,
    x: element.x + FREE_DUPLICATE_OFFSET,
    y: element.y + FREE_DUPLICATE_OFFSET,
    zIndex,
  };
  return { freeLayout: [...freeLayout, copy], newId };
}

/**
 * 指定 id の要素を複製した配列と、コピーの新 id を返す（id が無ければ変化なし・newId=null）。
 * 同一 freeLayout 内のコピペ＝pasteFreeElement に委譲（新 id 採番・少しずらして最前面）。
 */
export function duplicateFreeElement(
  freeLayout: FreeElement[], id: string,
): { freeLayout: FreeElement[]; newId: string | null } {
  const source = freeLayout.find((e) => e.id === id);
  if (!source) return { freeLayout, newId: null };
  return pasteFreeElement(freeLayout, source);
}

/** zIndex を他要素の最大+1 にして最前面へ（id 不在・単独要素は変化なし）。 */
export function bringFreeElementToFront(freeLayout: FreeElement[], id: string): FreeElement[] {
  if (!freeLayout.some((e) => e.id === id)) return freeLayout;
  const others = freeLayout.filter((e) => e.id !== id);
  if (others.length === 0) return freeLayout;
  const maxOther = others.reduce((max, e) => Math.max(max, e.zIndex ?? 0), 0);
  return freeLayout.map((e) => (e.id === id ? { ...e, zIndex: maxOther + 1 } : e));
}

/**
 * zIndex を他要素の最小−1 にして最背面へ（id 不在・単独要素は変化なし）。
 * 0 を下限とする＝FREE テンプレ背景（zIndex 0）の裏へ回り込んで消えないように。
 */
export function sendFreeElementToBack(freeLayout: FreeElement[], id: string): FreeElement[] {
  if (!freeLayout.some((e) => e.id === id)) return freeLayout;
  const others = freeLayout.filter((e) => e.id !== id);
  if (others.length === 0) return freeLayout;
  const minOther = others.reduce((min, e) => Math.min(min, e.zIndex ?? 0), Number.POSITIVE_INFINITY);
  return freeLayout.map((e) => (e.id === id ? { ...e, zIndex: Math.max(0, minOther - 1) } : e));
}

/**
 * 重ね順を1段だけ前面('up')/背面('down')へ動かす（レイヤー一覧の↑↓・#210）。
 * zIndex 昇順で隣の要素と zIndex を入れ替える。端ならそのまま。同 zIndex のときは移動方向へ寄せて前後を確定（背面側は 0 が下限）。
 */
export function moveFreeElementZ(
  freeLayout: FreeElement[], id: string, direction: 'up' | 'down',
): FreeElement[] {
  // zIndex 既定は 1（layout の描画既定・パネルの並び順と一致＝absent z を同じに扱う）。入れ替えの意味論は共有（§2-7）。
  return moveByZ(freeLayout, id, direction, (e) => e.zIndex ?? 1);
}

// ── ドラッグ移動・角リサイズのジオメトリ（Phase 4b）。純粋関数＝§7 テスト対象。 ──

/** ドラッグ/リサイズで潰れないための最小サイズ（canvas px・schema は w>0/h>0）。テンプレ Layer と共有する GEOM_MIN_SIZE を参照（§2-7）。 */
export const FREE_MIN_SIZE = GEOM_MIN_SIZE;

/** 吸着グリッドの既定サイズ（canvas px）。「グリッドに合わせる」ON のとき使う。 */
export const FREE_GRID_SIZE = 20;

/** 値をグリッドへ吸着（canvas 座標）。grid<=0 は整数丸めのみ（吸着なし＝従来動作）。 */
export function snapToGrid(value: number, grid: number): number {
  return grid > 0 ? Math.round(value / grid) * grid : Math.round(value);
}

/** リサイズで掴んだ角（対角を固定する）。 */
export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 要素をドラッグ移動した後の位置（canvas 座標・整数）。dx/dy はドラッグ開始からの総移動量（canvas 単位）。
 * 画面外も許容（一部はみ出しは演出。検証は validateFreeLayout が警告のみ）。
 */
export function moveFreeElement(
  start: Geom, dx: number, dy: number, grid = 0,
): { x: number; y: number } {
  return { x: snapToGrid(start.x + dx, grid), y: snapToGrid(start.y + dy, grid) };
}

/**
 * 角ハンドルでリサイズした後の矩形（canvas 座標・整数）。掴んだ角を動かし対角を固定、最小サイズで止める。
 * dx/dy はドラッグ開始からの総移動量（canvas 単位）。
 * lockAspect=true（Shift 押下）で開始時の縦横比を維持する（比を優先し、グリッド吸着は無視）。
 */
export function resizeFreeElement(
  start: Geom, corner: ResizeCorner, dx: number, dy: number,
  min: number = FREE_MIN_SIZE, grid = 0, lockAspect = false,
): Geom {
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  const movesWest = corner === 'nw' || corner === 'sw';
  const movesEast = corner === 'ne' || corner === 'se';
  const movesNorth = corner === 'nw' || corner === 'ne';
  const movesSouth = corner === 'sw' || corner === 'se';

  // Shift＝縦横比維持。動かした量が大きい方の軸を主軸に拡大率を求め、両辺へ等倍適用（対角は固定）。
  // 最小サイズは両辺で担保。比を優先するためグリッド吸着はしない。
  if (lockAspect) {
    const grewW = movesEast ? dx : movesWest ? -dx : 0;
    const grewH = movesSouth ? dy : movesNorth ? -dy : 0;
    const scaleByDominant =
      Math.abs(grewW) >= Math.abs(grewH) ? (start.w + grewW) / start.w : (start.h + grewH) / start.h;
    const scale = Math.max(scaleByDominant, min / start.w, min / start.h);
    const w = Math.round(start.w * scale);
    const h = Math.round(start.h * scale);
    const x = movesWest ? right - w : start.x; // 西側の角は右辺を固定
    const y = movesNorth ? bottom - h : start.y; // 北側の角は下辺を固定
    return { x: Math.round(x), y: Math.round(y), w, h };
  }

  let { x, y, w, h } = start;
  // 掴んだ辺をグリッドへ吸着（grid=0 は整数丸め＝従来動作）。対角を固定し、最小サイズで止める。
  // 辺を先に確定（snap）→ 固定辺から w/h を逆算するので、固定辺は整数で厳密に保たれる（小数でも 1px ずれない）。
  if (movesEast) w = Math.max(min, snapToGrid(right + dx, grid) - x);
  if (movesWest) {
    w = Math.max(min, right - snapToGrid(start.x + dx, grid));
    x = right - w; // 右辺を固定
  }
  if (movesSouth) h = Math.max(min, snapToGrid(bottom + dy, grid) - y);
  if (movesNorth) {
    h = Math.max(min, bottom - snapToGrid(start.y + dy, grid));
    y = bottom - h; // 下辺を固定
  }
  // w/h も明示的に整数化（grid/min が将来非整数でも整数を返す＝renderer に小数を渡さない）。
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/**
 * 回転した要素の角リサイズ（#279 後継・#300(b) でグリッド対応）。掴んだ角を動かし、**対角を canvas 上で固定**する。
 * 回転中心は要素中心（CSS/SVG の rotate と同じ）。rotationDeg=0 は resizeFreeElement と一致（θ=0 で恒等）。
 *
 * - **縦横比維持（lockAspect）**：比を優先しグリッドは無視するため、ローカル（未回転）系で resizeFreeElement を
 *   流用し、対角固定になるよう中心を rotate(θ) で補正して逆算する（従来どおり）。
 * - **通常**：掴んだ角の canvas 位置をグリッドへ吸着（grid>0＝canvas グリッド／grid=0＝整数丸め）し、固定した対角から
 *   w/h を逆算する。これで**回転後の見た目の角**が canvas グリッドに乗る（ローカル系 snap では乗らなかった＝#300(b)）。
 */
export function resizeRotatedFreeElement(
  start: Geom, corner: ResizeCorner, dx: number, dy: number, rotationDeg: number,
  min: number = FREE_MIN_SIZE, grid = 0, lockAspect = false,
): Geom {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx0 = start.x + start.w / 2;
  const cy0 = start.y + start.h / 2;
  // ローカル（中心基準）→ canvas のオフセット変換：rotate(θ)。
  const toCanvas = (lx: number, ly: number): { x: number; y: number } => ({ x: lx * cos - ly * sin, y: lx * sin + ly * cos });

  if (lockAspect) {
    // canvas → ローカル：rotate(-θ)。w/h は従来ロジック（比維持・grid 無視）を流用。
    const ldx = dx * cos + dy * sin;
    const ldy = -dx * sin + dy * cos;
    const { w, h } = resizeFreeElement(start, corner, ldx, ldy, min, grid, true);
    // 固定する対角 A（掴んだ角の逆）を canvas 上で動かさないよう中心を rotate(θ) で補正。
    const signAx = corner === 'ne' || corner === 'se' ? -1 : 1;
    const signAy = corner === 'sw' || corner === 'se' ? -1 : 1;
    const off = toCanvas((signAx * (start.w - w)) / 2, (signAy * (start.h - h)) / 2);
    return { x: Math.round(cx0 + off.x - w / 2), y: Math.round(cy0 + off.y - h / 2), w, h };
  }

  // 掴んだ角の符号（東=+1/西=-1、南=+1/北=-1）。対角 A はこの逆符号。
  const ex = corner === 'ne' || corner === 'se' ? 1 : -1;
  const ey = corner === 'sw' || corner === 'se' ? 1 : -1;
  const a = toCanvas((-ex * start.w) / 2, (-ey * start.h) / 2); // 固定する対角（中心からのオフセット）
  const b0 = toCanvas((ex * start.w) / 2, (ey * start.h) / 2); // 掴んだ角（開始）
  const ax = cx0 + a.x;
  const ay = cy0 + a.y;
  // 掴んだ角を canvas 上でドラッグ→グリッド吸着。
  const bx = snapToGrid(cx0 + b0.x + dx, grid);
  const by = snapToGrid(cy0 + b0.y + dy, grid);
  // 対角 A→B をローカルへ戻すと (ex·w, ey·h)。掴んだ角の向き(ex/ey)で**符号付きのまま** min クランプする
  // ＝対角を超えて振り切っても min に張り付く（abs を先に取ると符号反転で再拡大＝跳ね返る＝#300 レビュー）。
  // 通常ドラッグ（縮む方向に振り切らない）では ex·(…)≧0 で abs と一致＝挙動は不変。resizeFreeElement と同じ片側クランプ。
  const ddx = bx - ax;
  const ddy = by - ay;
  const w = Math.max(min, Math.round(ex * (ddx * cos + ddy * sin)));
  const h = Math.max(min, Math.round(ey * (-ddx * sin + ddy * cos)));
  // A を固定して中心を出す（clamp で w/h が変わっても対角 A は動かさない）。
  const c = toCanvas((ex * w) / 2, (ey * h) / 2);
  return { x: Math.round(ax + c.x - w / 2), y: Math.round(ay + c.y - h / 2), w, h };
}
