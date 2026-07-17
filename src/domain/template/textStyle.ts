// 文字の体裁（色/サイズ/太さ/縁取り）の継承解決。純粋関数（副作用なし・§4：domain は他層に依存しない）。
//
// **置き場が domain なのは共有先が3層にまたがるから**（`resolveSlotClip`＝domain/asset/clip.ts と同じ流儀）:
//   - renderer（`layoutScene`）＝実描画
//   - app（場面編集の体裁欄）＝「見た目パターンに合わせる」ときの表示値
//   - domain（`freeLayoutFromPlacedContent`）＝通常→FREE 変換で持ち込む値（ADR-0030）
// renderer に置くと domain から呼べず（§4）、変換だけ別解決になって「FREE 化したら体裁が戻る」を招く（#555 レビュー）。
import { FONT_WEIGHT } from '../enums';
import type { FontWeight } from '../enums';
import type { Layer } from './types';
import type { TextStyleOverride } from '../project/types';

/** テキストの既定色/既定サイズ。描画・インライン編集・体裁欄で共有する単一の参照元（§2-7・#549）。 */
export const DEFAULT_TEXT_COLOR = '#222222';
export const DEFAULT_FONT_SIZE = 40;
/** 縁取りの太さ>0 で色が未指定のときの既定色（色だけ無いと縁取りが silent に消えるのを防ぐ・#275/PR#289）。 */
export const DEFAULT_STROKE_COLOR = '#ffffff';

/** 通常テンプレの text/subtitle 層の「実際に描く体裁」。`resolveTextStyle` の戻り値。 */
export interface ResolvedTextStyle {
  color: string;
  fontSize: number;
  fontWeight: FontWeight;
  strokeColor?: string;
  strokeWidth?: number;
}

/** 体裁を持ちうる層の部分型（Layer と FreeElement のどちらからも渡せる）。 */
export type TextStyleSource = Pick<Layer, 'color' | 'fontSize' | 'fontWeight' | 'strokeColor' | 'strokeWidth'>;

/**
 * テンプレ層＋場面の上書き（`scene.textStyles`・#555）から、実際に描く文字の体裁を解決する。
 * 継承の順序は **場面の上書き → テンプレ層 → 既定**（各プロパティ独立＝触ったものだけ固有値・11 §6）。
 *
 * `??` で繋ぐので **falsy な有効値は継承に倒れない**（`strokeWidth: 0`＝「縁取りなし」を明示指定できる）。
 */
export function resolveTextStyle(layer: TextStyleSource, ov?: TextStyleOverride): ResolvedTextStyle {
  const strokeWidth = ov?.strokeWidth ?? layer.strokeWidth;
  const strokeColorRaw = ov?.strokeColor ?? layer.strokeColor;
  return {
    color: ov?.color ?? layer.color ?? DEFAULT_TEXT_COLOR,
    fontSize: ov?.fontSize ?? layer.fontSize ?? DEFAULT_FONT_SIZE,
    fontWeight: ov?.fontWeight ?? layer.fontWeight ?? FONT_WEIGHT.normal,
    // 太さ>0 で色未指定なら既定色。**上書きを解決したあとの値で判定する**＝場面で太さだけ足しても縁取りが消えない。
    strokeColor: (strokeWidth ?? 0) > 0 ? (strokeColorRaw ?? DEFAULT_STROKE_COLOR) : strokeColorRaw,
    strokeWidth,
  };
}
