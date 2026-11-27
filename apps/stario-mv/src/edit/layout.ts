// 欄の大きさ（MV-0008 決定3＝境目を掴んで変えられる・大きさは画面の好みとして手元に覚える＝プロジェクトには書かない）。
import { useCallback, useState } from "react";

export interface PaneSizes {
  /** 左の素材の一覧の幅。 */
  left: number;
  /** 右の値の欄の幅。 */
  right: number;
  /** 下のタイムラインの高さ。 */
  bottom: number;
}

export const DEFAULT_SIZES: PaneSizes = { left: 220, right: 280, bottom: 260 };
export const MIN_SIZES: PaneSizes = { left: 120, right: 160, bottom: 120 };
export const MAX_SIZE = 1200;
export const LAYOUT_KEY = "stario-mv.layout";

/** 覚えている大きさを読む（読めない・壊れているときは既定・範囲の外は収める）。 */
export function loadSizes(read: () => string | null): PaneSizes {
  const r = (parseOrNull(read) ?? {}) as Partial<Record<keyof PaneSizes, unknown>>;
  const pick = (k: keyof PaneSizes): number => {
    const v = r[k];
    return typeof v === "number" && Number.isFinite(v) ? clampSize(k, v) : DEFAULT_SIZES[k];
  };
  return { left: pick("left"), right: pick("right"), bottom: pick("bottom") };
}

function parseOrNull(read: () => string | null): unknown {
  try {
    return JSON.parse(read() ?? "null");
  } catch {
    return null;
  }
}

export function clampSize(k: keyof PaneSizes, v: number): number {
  return Math.round(Math.max(MIN_SIZES[k], Math.min(MAX_SIZE, v)));
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 欄の大きさと、それを変えて覚える手続き。 */
export function usePaneSizes(): [PaneSizes, (k: keyof PaneSizes, v: number) => void] {
  const [sizes, setSizes] = useState<PaneSizes>(() => loadSizes(() => storage()?.getItem(LAYOUT_KEY) ?? null));
  const set = useCallback((k: keyof PaneSizes, v: number) => {
    setSizes((s) => {
      const next = { ...s, [k]: clampSize(k, v) };
      try {
        storage()?.setItem(LAYOUT_KEY, JSON.stringify(next));
      } catch {
        // 覚えられなくても動く（画面の好みだけ）
      }
      return next;
    });
  }, []);
  return [sizes, set];
}
