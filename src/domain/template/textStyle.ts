// 文字の体裁（色/サイズ/太さ/縁取り）の継承解決。純粋関数（副作用なし・§4：domain は他層に依存しない）。
//
// **置き場が domain なのは共有先が3層にまたがるから**（`resolveSlotClip`＝domain/asset/clip.ts と同じ流儀）:
//   - renderer（`layoutScene`）＝実描画
//   - app（場面編集の体裁欄）＝「見た目パターンに合わせる」ときの表示値
//   - domain（`freeLayoutFromPlacedContent`）＝通常→FREE 変換で持ち込む値（ADR-0030）
// renderer に置くと domain から呼べず（§4）、変換だけ別解決になって「FREE 化したら体裁が戻る」を招く（#555 レビュー）。
import { FONT_WEIGHT } from '../enums';
import type { FontWeight } from '../enums';
import type { Layer, LayerBackground, TextShadow } from './types';
import type { TextStyleOverride } from '../project/types';

/** テキストの既定色/既定サイズ。描画・インライン編集・体裁欄で共有する単一の参照元（§2-7・#549）。 */
export const DEFAULT_TEXT_COLOR = '#222222';
export const DEFAULT_FONT_SIZE = 40;
/**
 * 縁取り/枠線の太さ>0 で**色が未指定**のときに使う既定色（色だけ無いと縁取りが silent に消えるのを防ぐ・#275/PR#289）。
 * **下地（文字色・図形の塗り）と反対側**を選ぶ＝固定の白だと「白文字に白い縁取り」で結局なにも起きず、
 * 同じ苦情（太さを入れたのに変わらない）に戻る（#565・ADR-0026①）。
 */
export const STROKE_COLOR_ON_DARK = '#ffffff';
export const STROKE_COLOR_ON_LIGHT = '#000000';
/** テキストの既定行間（倍率）。行数計算と描画で共有する（#209）。 */
export const DEFAULT_LINE_HEIGHT = 1.3;
/**
 * 通常テンプレの text/subtitle 層の既定の行数上限（`layer.maxLines` 未指定時）。
 * 描画（layoutScene）と通常→FREE 変換（`freeLayoutFromPlacedContent`）で共有する＝**変換後の行数が描画と一致する**（§2-7）。
 */
export const DEFAULT_TEMPLATE_MAX_LINES = 2;

/**
 * FREE 要素の**枠高から表示行数を導出**する（FREE の行数モデル＝箱の高さが入る行数を決める・ADR-0008）。
 * 通常テンプレは `layer.maxLines`（既定2）で行数を決める＝**別モデル**なので、通常→FREE 変換では
 * `boxHeightForLines` で行数を保つ枠高へ翻訳する（#555 レビュー P1）。
 */
export function linesForBoxHeight(h: number, fontSize: number, lineHeight: number = DEFAULT_LINE_HEIGHT): number {
  return Math.max(1, Math.floor(h / (fontSize * lineHeight)));
}

/**
 * 指定行数が入る最小の枠高（`linesForBoxHeight` の逆）。通常→FREE 変換で**表示行数を保つ**のに使う。
 *
 * **`ceil` だけでは足りない**：`Math.ceil(5*12*1.3)` は 78 になるが `78 / (12*1.3)` は二進で 4.999999999999999 で、
 * `floor` すると **1行減る**。丸めの偶然に頼らず、**守りたい不変条件（行数）を満たすまで詰めて**逆関数であることを
 * 構造で保証する（通常は 0〜1 回で収束）。往復は textStyle.test.ts で検証する。
 */
export function boxHeightForLines(lines: number, fontSize: number, lineHeight: number = DEFAULT_LINE_HEIGHT): number {
  const n = Math.max(1, lines);
  let h = Math.ceil(n * fontSize * lineHeight);
  while (linesForBoxHeight(h, fontSize, lineHeight) < n) h += 1;
  return h;
}

/** 通常テンプレの text/subtitle 層の「実際に描く体裁」。`resolveTextStyle` の戻り値。 */
export interface ResolvedTextStyle {
  color: string;
  fontSize: number;
  fontWeight: FontWeight;
  strokeColor?: string;
  strokeWidth?: number;
  /** 字間（em・#264）。未指定＝0（従来の出力は不変）。 */
  letterSpacing?: number;
  /** 文字の影（#264）。`enabled` でないものは `undefined` にして返す＝描く側が条件を持たない。 */
  shadow?: TextShadow;
  /** 背景帯（#264 で文字にも一般化）。`enabled` でないものは `undefined`（同上）。 */
  background?: ResolvedBand;
}

/** 体裁を持ちうる層の部分型（Layer と FreeElement のどちらからも渡せる）。 */
export type TextStyleSource = Pick<
  Layer,
  'color' | 'fontSize' | 'fontWeight' | 'strokeColor' | 'strokeWidth' | 'letterSpacing' | 'shadow'
> & { background?: LayerBackground };

/**
 * テンプレ層＋場面の上書き（`scene.textStyles`・#555）から、実際に描く文字の体裁を解決する。
 * 継承の順序は **場面の上書き → テンプレ層 → 既定**（各プロパティ独立＝触ったものだけ固有値・11 §6）。
 *
 * `??` で繋ぐので **falsy な有効値は継承に倒れない**（`strokeWidth: 0`＝「縁取りなし」を明示指定できる）。
 */
export function resolveTextStyle(layer: TextStyleSource, ov?: TextStyleOverride): ResolvedTextStyle {
  const strokeWidth = ov?.strokeWidth ?? layer.strokeWidth;
  const strokeColorRaw = ov?.strokeColor ?? layer.strokeColor;
  const color = ov?.color ?? layer.color ?? DEFAULT_TEXT_COLOR;
  return {
    color,
    fontSize: ov?.fontSize ?? layer.fontSize ?? DEFAULT_FONT_SIZE,
    fontWeight: ov?.fontWeight ?? layer.fontWeight ?? FONT_WEIGHT.normal,
    // **上書きを解決したあとの値で判定する**＝場面で太さだけ足しても縁取りが消えない。下地は解決後の文字色。
    strokeColor: resolveStrokeColor(strokeWidth, strokeColorRaw, color),
    strokeWidth,
    letterSpacing: ov?.letterSpacing ?? layer.letterSpacing,
    // ⚠️ **`enabled` の判定はここで済ませる**（#264）＝描く側に条件を持たせると、
    // プレビューと書き出しで**別々に判定する場所**ができる（片方だけ直る形が生まれる）。
    shadow: enabledShadow(ov?.shadow ?? layer.shadow),
    background: bandBackground(ov?.background ?? layer.background),
  };
}

/** `enabled` の影だけを返す（既定は黒・濃さ 0.5）。`enabled` でなければ `undefined`。 */
export function enabledShadow(shadow: TextShadow | undefined): TextShadow | undefined {
  if (!shadow?.enabled) return undefined;
  return {
    enabled: true,
    color: shadow.color ?? DEFAULT_SHADOW_COLOR,
    opacity: shadow.opacity ?? DEFAULT_SHADOW_OPACITY,
    blur: shadow.blur ?? 0,
    dx: shadow.dx ?? 0,
    dy: shadow.dy ?? 0,
  };
}

/** 描くときの背景帯（既定を埋めた形）。 */
export type ResolvedBand = { color: string; opacity: number; radius: number };

/**
 * `enabled` の背景帯だけを返す（既定は黒・濃さ 0.55・角丸 16）。`enabled` でなければ `undefined`。
 *
 * ⚠️ **定義は1つ**（§2-7）＝以前は `renderer/layout.ts` に `bandBackground` があったが、
 * #264 で場面の上書き（`scene.textStyles`）も帯を持つようになったので、**解決の場所**である
 * `resolveTextStyle` の隣へ移した（renderer は再輸出だけ＝既存の import 経路を保つ）。
 * インライン編集（`FreeLayoutOverlay`）も同じ既定で帯を敷く＝編集中と描画結果がドリフトしない（#549）。
 */
export function bandBackground(bg: LayerBackground | undefined): ResolvedBand | undefined {
  if (!bg?.enabled) return undefined;
  return {
    color: bg.color ?? DEFAULT_BAND_COLOR,
    opacity: bg.opacity ?? DEFAULT_BAND_OPACITY,
    radius: bg.radius ?? DEFAULT_BAND_RADIUS,
  };
}

/** 影の既定（#264）。⚠️ **値の出どころは1か所**＝画面の初期値と描画がずれない（§2-7）。 */
export const DEFAULT_SHADOW_COLOR = '#000000';
export const DEFAULT_SHADOW_OPACITY = 0.5;
/** 背景帯の既定（#529 から引き継ぎ・`bandBackground` と同じ値）。 */
export const DEFAULT_BAND_COLOR = '#000000';
export const DEFAULT_BAND_OPACITY = 0.55;
export const DEFAULT_BAND_RADIUS = 16;

/**
 * 縁取り/枠線の色の解決（**単一の参照元**）。太さ>0 で色が未指定なら下地と反対の既定色、そうでなければ指定値をそのまま。
 *
 * 通常テンプレの文字（`resolveTextStyle`）と FREE 要素（文字/字幕/図形＝`layoutScene`）、体裁欄の色見本が
 * これを共有する＝**「見本は色を出すのに描かれない」「太さを入れたのに何も起きない」が構造的に起きない**（§2-7・#565）。
 * 太さ 0/未指定のときに色を消さないのは、太さを 0 に戻しても選んだ色が残る＝また太くすれば元に戻るため。
 */
export function resolveStrokeColor(
  strokeWidth: number | undefined, strokeColor: string | undefined, baseColor: string,
): string | undefined {
  return (strokeWidth ?? 0) > 0 ? (strokeColor ?? defaultStrokeColor(baseColor)) : strokeColor;
}

/** 下地の色に対して見える既定の縁取り色（明るい下地→黒／暗い下地→白）。 */
export function defaultStrokeColor(baseColor: string): string {
  return relativeLuminance(baseColor) > STROKE_LIGHT_THRESHOLD ? STROKE_COLOR_ON_LIGHT : STROKE_COLOR_ON_DARK;
}

/**
 * 白と黒のどちらがより強くコントラストするかの境目（WCAG 2.x のコントラスト比が入れ替わる輝度）。
 * 比は白 `1.05/(L+0.05)`・黒 `(L+0.05)/0.05` なので、等しくなるのは `L = sqrt(0.0525) - 0.05`。
 * 既定の文字色（`#222222`・L≈0.012）は白側＝**#275 以来の挙動（白い縁取り）を保つ**。
 */
const STROKE_LIGHT_THRESHOLD = Math.sqrt(0.0525) - 0.05;

/**
 * 相対輝度（WCAG 2.x）。`#rgb`/`#rrggbb` 以外（未知の記法）は 0＝暗いとみなす＝白い縁取りを返す（従来どおり）。
 * schema の色は `^#[0-9a-fA-F]{6}$` に限られるので短縮形は防御。
 */
function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 0;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const ch = [0, 2, 4].map((i) => {
    const s = parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
