// クリップが画面のどこを占めるか（`11 §7.6.4`）。
//
// ⚠️ **未指定＝画面いっぱい**という解決を、描画（`renderer/timelineLayout`）と「バラす」（`explode`）が
// **別々に書いていた**。編集の入口（#685）が3人目の読み手になるので、その前に1か所へ出す。
// 片方だけ直すと「編集した箱と描かれる箱が違う」＝いちばん気づきにくい形で割れる。
import { FREE_ELEMENT_KIND } from '../enums';
import type { TimelineClipKind } from '../enums';
import type { TimelineClip } from './types';

/** 画面のどこを占めるか（回転は持っているときだけ）。 */
export type ClipBox = { x: number; y: number; w: number; h: number; rotation?: number };

/**
 * クリップの箱を解決する。**箱を持たないクリップは画面いっぱい**（見た目パターンのクリップは
 * 枠そのものなので幾何を持たない＝`11 §7.6.3`）。
 */
export function resolveClipBox(clip: TimelineClip, canvas: { width: number; height: number }): ClipBox {
  return {
    x: clip.x ?? 0,
    y: clip.y ?? 0,
    w: clip.w ?? canvas.width,
    h: clip.h ?? canvas.height,
    ...(clip.rotation != null ? { rotation: clip.rotation } : {}),
  };
}

/**
 * **箱を自分で持てる部品か**（#685）。自由配置の4種だけ。
 *
 * - **見た目パターンのクリップは持たない**＝枠そのもの（画面いっぱい）。中の層の幾何を触りたいときは
 *   「バラす」（ADR-0034 決定8）＝per-要素の上書きを新設しない。
 * - **音・読み上げには位置が無い**（画面に出ない）。
 *
 * ⚠️ 中身の項目（`VISUAL_CONTENT_KEYS`）で代用しない＝字幕は文字や図形の項目を持たないが
 * **箱は持つ**（置いて動かせる）。「中身を直せるか」と「動かせるか」は別の問い。
 */
export function canHaveBox(kind: TimelineClipKind): boolean {
  return (Object.values(FREE_ELEMENT_KIND) as string[]).includes(kind);
}
