// 動画ありシーンの下/上レイヤー分割（ADR-0006）。動画スロットの zIndex を境に、
// 下PNG（背景等・不透明・全面）と上PNG（文字/ゆうこ等・透過）の SVG を作る。
// スロット自身はどちらにも描かない（FFmpeg が動画で埋める＝透明な穴）。
import type { Rect, SceneLayout } from '../layout';
import { layoutToSvg } from '../sceneSvg';

export interface VideoSceneSplit {
  /** 動画より下のレイヤー（背景含む・不透明・全面）。 */
  belowSvg: string;
  /** 動画より上のレイヤー（透過）。 */
  aboveSvg: string;
  /** 動画スロットの矩形（FFmpeg のスケール/配置に使う）。 */
  slot: Rect;
}

/**
 * 動画スロット(slotId)を境に SceneLayout を下/上SVGへ分割する。slotId が無ければ null。
 * 下＝zIndex<slot（背景塗りあり）／上＝zIndex>=slot かつ slot 以外（透過）。
 */
export function splitVideoSceneSvg(
  layout: SceneLayout,
  slotId: string,
  assetSrc?: (assetId: string | null) => string | undefined,
): VideoSceneSplit | null {
  // 動画スロット（image かつ role=slot）のみを境界に使う。誤った id（fill/text 等）では境界を取らず null。
  const slot = layout.items.find(
    (it) => it.id === slotId && it.kind === 'image' && it.role === 'slot',
  );
  if (!slot) return null;
  const slotZ = slot.zIndex;
  // 下＝zIndex<slot ／ 上＝slot 自身を除く残り全部（zIndex>=slot）。
  // 「== slot」のアイテムを上に含めることで取りこぼし（描画漏れ）を防ぐ＝網羅的分割（ADR-0006 もこの規則）。
  const belowSvg = layoutToSvg(layout, {
    assetSrc,
    itemFilter: (it) => it.id !== slotId && it.zIndex < slotZ,
  });
  const aboveSvg = layoutToSvg(layout, {
    assetSrc,
    transparent: true,
    itemFilter: (it) => it.id !== slotId && it.zIndex >= slotZ,
  });
  return { belowSvg, aboveSvg, slot: { x: slot.x, y: slot.y, w: slot.w, h: slot.h } };
}
