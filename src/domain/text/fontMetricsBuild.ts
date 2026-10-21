// 同梱の字体の字幅表を作る（ADR-0063）。純粋。
//
// 作る道具（`scripts/gen-font-metrics.ts`）と、作った表が字体ファイルとずれていないかを見る検査が、
// **同じこの関数**を通す（片方だけ作り方が変わる、を作らない）。
import type { FontAdvanceReader } from '../font/fontAdvance';

/** 字体1つぶんの字幅表（字体の単位のまま持つ＝丸め誤差なし）。 */
export interface BundledFontMetrics {
  unitsPerEm: number;
  /** 字ごとに持つ区間：`[開始の字, 幅を36進で ',' 区切り（0＝字体に無い）]`。 */
  dense: readonly (readonly [number, string])[];
  /** CJK 統合漢字（4E00–9FFF）で、字体に有る字のいちばん多い幅。 */
  cjkDefault: number;
  /** CJK 統合漢字のうち字体に有る字（1字1ビット・base64）。 */
  cjkHave: string;
  /** CJK 統合漢字のうち既定と違う幅の字：`前の字からの差(36進):幅(36進)` を ',' 区切り。 */
  cjkOther: string;
}

/** 字ごとに持つ区間（英数字・ラテン補助・約物・かな・全角）。 */
export const DENSE_RANGES: readonly (readonly [number, number])[] = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x2000, 0x206f],
  [0x3000, 0x30ff],
  [0xff00, 0xffef],
];
export const CJK_START = 0x4e00;
export const CJK_END = 0x9fff;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** 字体1つを読んで字幅表を作る。 */
export function buildFontMetrics(reader: FontAdvanceReader): BundledFontMetrics {
  const dense = DENSE_RANGES.map(([a, b]) => {
    const ws: string[] = [];
    for (let cp = a; cp <= b; cp += 1) ws.push((reader.advanceOf(cp) ?? 0).toString(36));
    return [a, ws.join(',')] as const;
  });
  const have = new Uint8Array(Math.ceil((CJK_END - CJK_START + 1) / 8));
  const counts = new Map<number, number>();
  const widths: (number | null)[] = [];
  for (let cp = CJK_START; cp <= CJK_END; cp += 1) {
    const w = reader.advanceOf(cp);
    widths.push(w);
    if (w == null) continue;
    const i = cp - CJK_START;
    have[i >> 3]! |= 1 << (i & 7);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  let cjkDefault = reader.unitsPerEm;
  let best = -1;
  for (const [w, n] of counts) if (n > best || (n === best && w < cjkDefault)) { best = n; cjkDefault = w; }
  const other: string[] = [];
  let prev = CJK_START;
  widths.forEach((w, i) => {
    if (w == null || w === cjkDefault) return;
    const cp = CJK_START + i;
    other.push(`${(cp - prev).toString(36)}:${w.toString(36)}`);
    prev = cp;
  });
  return { unitsPerEm: reader.unitsPerEm, dense, cjkDefault, cjkHave: toBase64(have), cjkOther: other.join(',') };
}
