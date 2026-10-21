// 字体ファイルから字の送り幅（hmtx）を読む（ADR-0063）。純粋・同期。
//
// 字幅表を作る道具（`scripts/gen-font-metrics.ts`）と、その表が字体ファイルとずれていないかを見る検査が使う。
// アプリの実行時には使わない（実行時は作った表を引く＝`src/domain/text/fontMetrics.ts`）。
import { cmapLookup, readTables } from './fontSubset';

/** 字体1つぶんの「字 → 送り幅（字体の単位）」を引く道具。字体に無い字は `null`。 */
export interface FontAdvanceReader {
  unitsPerEm: number;
  advanceOf: (codePoint: number) => number | null;
}

/** TrueType／OpenType の字体ファイルを読む。読めなければ `null`。 */
export function readFontAdvances(bytes: Uint8Array): FontAdvanceReader | null {
  const tables = readTables(bytes);
  if (!tables) return null;
  const head = tables.get('head');
  const hhea = tables.get('hhea');
  const hmtx = tables.get('hmtx');
  if (!head || !hhea || !hmtx) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const unitsPerEm = v.getUint16(head.offset + 18);
  const numberOfHMetrics = v.getUint16(hhea.offset + 34);
  const look = cmapLookup(bytes, tables);
  return {
    unitsPerEm,
    advanceOf: (cp) => {
      const g = look(cp);
      if (g === 0) return null; // 字体に無い（.notdef）
      // numberOfHMetrics より後ろの字は、最後の送り幅を共有する（OpenType の決まり）。
      const i = Math.min(g, numberOfHMetrics - 1);
      return v.getUint16(hmtx.offset + i * 4);
    },
  };
}
