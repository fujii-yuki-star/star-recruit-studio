// 断りの**出る場所**は `blockTargetFor` に1つだけ（#869・α-6 出口監査 🟡17）。
//
// ⚠️ **集約点を素通りさせない**＝`applyEditTo` は ~20 操作が通る集約点なのに例外判定を通っておらず、
// 「書き出し中」「再生中」「対象が無い」が**欄の中**に落ちていた（欄を閉じていると押した返事が見えない）。
// `moveClipsBy` は帯へ倒すのに `moveClipById` は欄へ、という**同じ状況で出る場所が違う**形でもあった。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** `editBlocked` を書いている行（`at:` を持つもの）。 */
function editBlockedLines(): string[] {
  const src = readFileSync(join(process.cwd(), 'src/app/store/timelineStore.ts'), 'utf8');
  return src
    .split('\n')
    .filter((l) => l.includes('editBlocked: { reason'))
    .filter((l) => !l.includes('editBlocked: { reason: EditBlockedReason')); // 型の宣言は対象外
}

describe('断りの出る場所（🟡17）', () => {
  it('`editBlocked` を書くところは、必ず `blockTargetFor` を通る（固定の帯を除く）', () => {
    const bypass = editBlockedLines()
      // ⚠️ **最初から帯**（`BLOCK_GLOBAL`）は通す必要が無い＝`blockTargetFor` の答えと同じ。
      .filter((l) => !l.includes('at: BLOCK_GLOBAL'))
      .filter((l) => !l.includes('blockTargetFor'))
      .map((l) => l.trim().slice(0, 80));
    expect(bypass).toEqual([]);
  });

  it('見ている行が消えていない（走査が空振りしていない）', () => {
    expect(editBlockedLines().length).toBeGreaterThanOrEqual(15);
  });
});
