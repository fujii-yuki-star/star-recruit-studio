// FREE テンプレ場面の自由配置（scene.freeLayout）への要素の追加・更新・削除（ADR-0008・Phase 4a-3b）。
// 純粋関数（副作用なし）。store は updateScene 経由でこれらを呼び、結果の配列で freeLayout を差し替える。
// ID 採番は createFreeElementId（§2.1・scene 内一意）に委譲する。
import { DEFAULT_FIT } from '../constants';
import { FONT_WEIGHT, FREE_ELEMENT_KIND, FREE_SHAPE_TYPE } from '../enums';
import type { FreeElementKind } from '../enums';
import { createFreeElementId } from './persistence';
import type { FreeElement } from './types';

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
const DEFAULT_TEXT_COLOR = '#222222';
const DEFAULT_SHAPE_COLOR = '#cccccc';

/** 新しい要素を1つ生成する（id は scene 内一意・zIndex は既存の最前面+1 で最前面に置く）。 */
export function createFreeElement(freeLayout: FreeElement[], kind: FreeElementKind): FreeElement {
  const id = createFreeElementId(freeLayout.map((e) => e.id));
  const zIndex = freeLayout.reduce((max, e) => Math.max(max, e.zIndex ?? 0), 0) + 1;
  const base = { id, x: DEFAULT_X, y: DEFAULT_Y, zIndex };
  switch (kind) {
    case FREE_ELEMENT_KIND.slot:
      return { ...base, kind, w: DEFAULT_SLOT_W, h: DEFAULT_SLOT_H, assetId: null, fit: DEFAULT_FIT };
    case FREE_ELEMENT_KIND.text:
      return {
        ...base, kind, w: DEFAULT_TEXT_W, h: DEFAULT_TEXT_H,
        text: DEFAULT_TEXT, fontSize: DEFAULT_TEXT_FONT_SIZE, color: DEFAULT_TEXT_COLOR, fontWeight: FONT_WEIGHT.normal,
      };
    case FREE_ELEMENT_KIND.shape:
      return {
        ...base, kind, w: DEFAULT_SHAPE_W, h: DEFAULT_SHAPE_H,
        shapeType: FREE_SHAPE_TYPE.rect, fillColor: DEFAULT_SHAPE_COLOR, opacity: 1, radius: 0,
      };
    default: {
      // FreeElementKind を網羅していることを型で保証する（kind 追加時はコンパイルエラー）。
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** 指定 kind の新規要素を末尾に追加した配列を返す。 */
export function addFreeElement(freeLayout: FreeElement[], kind: FreeElementKind): FreeElement[] {
  return [...freeLayout, createFreeElement(freeLayout, kind)];
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

// ── ドラッグ移動・角リサイズのジオメトリ（Phase 4b）。純粋関数＝§7 テスト対象。 ──

/** ドラッグ/リサイズで潰れないための最小サイズ（canvas px）。schema は w>0/h>0。 */
export const FREE_MIN_SIZE = 20;

/** 吸着グリッドの既定サイズ（canvas px）。「グリッドに合わせる」ON のとき使う。 */
export const FREE_GRID_SIZE = 20;

/** 値をグリッドへ吸着（canvas 座標）。grid<=0 は整数丸めのみ（吸着なし＝従来動作）。 */
export function snapToGrid(value: number, grid: number): number {
  return grid > 0 ? Math.round(value / grid) * grid : Math.round(value);
}

/** リサイズで掴んだ角（対角を固定する）。 */
export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

interface Geom {
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
 */
export function resizeFreeElement(
  start: Geom, corner: ResizeCorner, dx: number, dy: number, min: number = FREE_MIN_SIZE, grid = 0,
): Geom {
  let { x, y, w, h } = start;
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  const movesWest = corner === 'nw' || corner === 'sw';
  const movesEast = corner === 'ne' || corner === 'se';
  const movesNorth = corner === 'nw' || corner === 'ne';
  const movesSouth = corner === 'sw' || corner === 'se';
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
