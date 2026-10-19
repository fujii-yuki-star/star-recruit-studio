// 文字の幅を、同梱の字体の実測表から引く（ADR-0063）。純粋・同期・決定的。
//
// ⚠️ **どの字体かは呼ぶ側が決めて渡す**（`TextFont`）＝描画（字体の名前）と折返し（字幅）が同じものを見る。
// ⚠️ **字体に無い字・表の外の字は今までの見積もり**（英数字＝0.55em・それ以外＝1.0em）＝代わりの字体で描かれるので
//   字体からは幅が分からない。
// ⚠️ **持ち込み・拡張パックの字体は汎用の表**＝字ごとに「今までの見積もり」と「Gen Interface JP 太字の実測」の大きい方
//   （今より狭く見ない＝今出ている注意を黙って消さない）。
import { BUNDLED_FONT_FILES, cssFamilyForId, isExternalFontId, resolveFontId, type FontId } from '../font/fontCatalog';
import { FONT_WEIGHT } from '../enums';
import { CJK_END, CJK_START, type BundledFontMetrics } from './fontMetricsBuild';
import { BUNDLED_FONT_METRICS } from './generated/bundledFontMetrics';

/** 折返しの計算に使う字体（描画と同じ解き方で決めたもの）。 */
export interface TextFont {
  fontId: FontId | string;
  bold: boolean;
}

/**
 * 文字アイテムの字体を決める（**描画と同じ解き方**＝要素自身 → 場面 → 動画全体 → 既定・#178）。
 * ⚠️ **ここ以外で字体を解かない**（ADR-0063 決定2）＝描く字体（`sceneSvg` の font-family）と折返しの幅が
 * 同じ値から出る。
 */
export function textFontFor(
  itemFontId: string | null | undefined,
  sceneFontId: string | null | undefined,
  projectFontId: string | null | undefined,
  fontWeight: string | undefined,
): TextFont {
  return { fontId: resolveFontId(itemFontId, resolveFontId(sceneFontId, projectFontId)), bold: fontWeight === FONT_WEIGHT.bold };
}

/** 今までの見積もり（ADR-0063 より前）。表の外・字体に無い字に使う。 */
export function estimatedCharWidthEm(codePoint: number): number {
  return codePoint <= 0xff ? 0.55 : 1.0;
}

/** 汎用の表の土台（持ち込み・拡張パックの字体）。 */
const GENERIC_BASE_FILE = BUNDLED_FONT_FILES['Gen Interface JP']!.bold;

interface ParsedMetrics {
  upm: number;
  dense: Map<number, number>;
  cjkDefault: number;
  cjkHave: Uint8Array;
  cjkOther: Map<number, number>;
}

const parsed = new Map<string, ParsedMetrics>();

function parse(m: BundledFontMetrics): ParsedMetrics {
  const dense = new Map<number, number>();
  for (const [start, ws] of m.dense) {
    ws.split(',').forEach((w, i) => {
      const n = parseInt(w, 36);
      if (n > 0) dense.set(start + i, n);
    });
  }
  const bin = atob(m.cjkHave);
  const cjkHave = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) cjkHave[i] = bin.charCodeAt(i);
  const cjkOther = new Map<number, number>();
  let cp = CJK_START;
  if (m.cjkOther) {
    for (const part of m.cjkOther.split(',')) {
      const [d, w] = part.split(':');
      cp += parseInt(d!, 36);
      cjkOther.set(cp, parseInt(w!, 36));
    }
  }
  return { upm: m.unitsPerEm, dense, cjkDefault: m.cjkDefault, cjkHave, cjkOther };
}

function metricsOf(file: string): ParsedMetrics | null {
  const hit = parsed.get(file);
  if (hit) return hit;
  const raw = BUNDLED_FONT_METRICS[file];
  if (!raw) return null;
  const p = parse(raw);
  parsed.set(file, p);
  return p;
}

/** 表で引ける幅（em）。字体に無い・表の外なら `null`。 */
function measuredEm(m: ParsedMetrics, codePoint: number): number | null {
  const d = m.dense.get(codePoint);
  if (d != null) return d / m.upm;
  if (codePoint >= CJK_START && codePoint <= CJK_END) {
    const i = codePoint - CJK_START;
    if (((m.cjkHave[i >> 3] ?? 0) & (1 << (i & 7))) === 0) return null;
    return (m.cjkOther.get(codePoint) ?? m.cjkDefault) / m.upm;
  }
  return null;
}

/** その字体の実体（同梱）。持ち込み・拡張パック・不明は `null`。 */
function bundledFileOf(font: TextFont): string | null {
  if (isExternalFontId(font.fontId)) return null;
  const files = BUNDLED_FONT_FILES[cssFamilyForId(font.fontId)];
  return files ? (font.bold ? files.bold : files.regular) : null;
}

/** 1字の幅（em）。字体を渡さないときは今までの見積もり。 */
export function charWidthEmIn(ch: string, font: TextFont | undefined): number {
  const cp = ch.codePointAt(0) ?? 0;
  const estimate = estimatedCharWidthEm(cp);
  if (!font) return estimate;
  const file = bundledFileOf(font);
  if (file) {
    const m = metricsOf(file);
    return (m && measuredEm(m, cp)) ?? estimate;
  }
  // 持ち込み・拡張パック＝汎用の表（今より狭く見ない）。
  const base = metricsOf(GENERIC_BASE_FILE);
  const measured = base ? measuredEm(base, cp) : null;
  return Math.max(estimate, measured ?? 0);
}
