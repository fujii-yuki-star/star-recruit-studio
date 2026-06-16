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

/** 指定 id の要素に patch を当てた配列を返す（id が無ければ変化なし）。kind は変更しない。 */
export function updateFreeElement(
  freeLayout: FreeElement[], id: string, patch: Partial<Omit<FreeElement, 'id' | 'kind'>>,
): FreeElement[] {
  return freeLayout.map((e) => (e.id === id ? { ...e, ...patch } : e));
}

/** 指定 id の要素を取り除いた配列を返す。 */
export function removeFreeElement(freeLayout: FreeElement[], id: string): FreeElement[] {
  return freeLayout.filter((e) => e.id !== id);
}
