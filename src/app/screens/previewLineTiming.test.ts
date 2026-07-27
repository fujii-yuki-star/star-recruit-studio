import { describe, expect, it } from 'vitest';
import { PREVIEW_MIN_PLAY_SEC } from '../../domain/constants';
import { lineAdvanceWindowSec } from './previewLineTiming';

// #608：中間行（次の行へ送る）と最終行（場面送り）は**同じ送りタイマー**なのに、下限が最終行にしか無かった。
// 窓が極端に短い中間行は字幕も有効行のハイライトも見えないまま一瞬で飛ぶ（ADR-0026②）。
// 一方、同時開始（ADR-0031）の窓0は**そのままでなければならない**（下限を掛けると2人目が遅れて並行でなくなる）。
const seg = (startSec: number, endSec: number) => ({ startSec, endSec });

describe('lineAdvanceWindowSec（掛け合いの行送りの窓・#608）', () => {
  it('十分に長い窓はそのまま（下限で伸ばさない）', () => {
    const segs = [seg(0, 2), seg(2, 5)];
    expect(lineAdvanceWindowSec(segs, 0)).toBe(2); // 次の行の開始まで
    expect(lineAdvanceWindowSec(segs, 1)).toBe(3); // 最終行＝場面末まで
  });

  it('極端に短い中間行の窓は下限まで伸ばす（一瞬で飛ばさない）', () => {
    // 開始秒を手で詰めた場合（ADR-0015 の簡易タイミング）や、ごく短い音声で起こる。
    expect(lineAdvanceWindowSec([seg(0, 0.05), seg(0.05, 8)], 0)).toBe(PREVIEW_MIN_PLAY_SEC);
  });

  it('最終行の下限は従来どおり（同じ規則を共有しても場面送りの挙動は変わらない）', () => {
    expect(lineAdvanceWindowSec([seg(0, 0.05)], 0)).toBe(PREVIEW_MIN_PLAY_SEC);
  });

  // ここが要：同時開始は「窓0で連鎖」して重ねて流す。下限を掛けると 0.3 秒ずれて並行でなくなる。
  it('同時開始（開始秒が同じ）の窓は 0 のまま', () => {
    const simul = [seg(0, 4), seg(0, 4), seg(4, 8)];
    expect(lineAdvanceWindowSec(simul, 0)).toBe(0); // 1人目→2人目は即時
    expect(lineAdvanceWindowSec(simul, 1)).toBe(4); // 同時グループの末→次グループは通常どおり
  });

  it('開始秒が逆転していても待たない（窓0）＝壊れたデータで固まらない', () => {
    expect(lineAdvanceWindowSec([seg(3, 5), seg(1, 5)], 0)).toBe(0);
  });

  // 下限はプレビューだけの都合（MP4 は実尺で焼く・ADR-0026③）。ここが書き出しへ漏れていないことは
  // 「セグメント（lineSegments）は書き出しと共有の正準で、この関数はそれを読むだけ」で担保する。
  it('元のセグメントを書き換えない（読むだけ＝書き出しの正準に触れない）', () => {
    const segs = [seg(0, 0.05), seg(0.05, 8)];
    const before = JSON.stringify(segs);
    lineAdvanceWindowSec(segs, 0);
    expect(JSON.stringify(segs)).toBe(before);
  });
});
