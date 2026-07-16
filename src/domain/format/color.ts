// 色の変換を1箇所に集約する（自前カラーピッカー #525-6）。UI では色コード（#rrggbb）で保存し、
// 画面では「色相・鮮やかさ・明るさ」を目で選べるよう HSV と往復する。純粋関数のみ（テスト対象）。
// h=色相 0〜360／s=鮮やかさ 0〜1／v=明るさ 0〜1。rgb は各 0〜255 の整数。

/** 色相・鮮やかさ・明るさ（HSV）。 */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** 赤緑青（各 0〜255）。 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** "#abc" / "abc" / "#aabbcc" / "AABBCC" を正規化して "#aabbcc"（小文字）に。無効なら null。 */
export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const [r, g, b] = s.split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`.toLowerCase();
  return null;
}

/** 正しい色コード（#rgb / #rrggbb）か。 */
export function isValidHex(input: string): boolean {
  return normalizeHex(input) !== null;
}

/** 色コード → rgb。無効なら null。 */
export function hexToRgb(hex: string): Rgb | null {
  const n = normalizeHex(hex);
  if (!n) return null;
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

/** rgb → 色コード（#rrggbb・小文字）。各成分は 0〜255 にクランプして整数化。 */
export function rgbToHex({ r, g, b }: Rgb): string {
  const hx = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

/** rgb → HSV。 */
export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

/** HSV → rgb。 */
export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let rgb: [number, number, number];
  if (hh < 60) rgb = [c, x, 0];
  else if (hh < 120) rgb = [x, c, 0];
  else if (hh < 180) rgb = [0, c, x];
  else if (hh < 240) rgb = [0, x, c];
  else if (hh < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const [r, g, b] = rgb;
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

/** 色コード → HSV。無効なら null。 */
export function hexToHsv(hex: string): Hsv | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(rgb) : null;
}

/** HSV → 色コード（#rrggbb）。 */
export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv));
}
