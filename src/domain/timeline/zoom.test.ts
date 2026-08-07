// タイムラインの表示倍率（#686 段階2・ADR-0034 決定13）。純粋関数なので domain で固定する。
import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM_INDEX, ZOOM_LEVELS, fitZoomIndex, stepZoomIndex, tickStepSec, zoomScrollLeft } from './zoom';

describe('fitZoomIndex（開いた直後は全体表示・決定13）', () => {
  it('全体が収まる段のうち**いちばん大きい**ものを選ぶ（ぎりぎり全部見える所から始める）', () => {
    // 幅 640px・尺 10秒 → 64px/秒 まで入る。段は [16,24,36,54,80,120] なので 54。
    expect(ZOOM_LEVELS[fitZoomIndex(10, 640)]).toBe(54);
  });

  it('どの段でも収まらない長い動画は、いちばん小さい段（それ以上は広げられない）', () => {
    expect(fitZoomIndex(600, 640)).toBe(0);
    expect(ZOOM_LEVELS[0]).toBe(16);
  });

  it('尺が 0／幅が測れないときは既定の段（目盛りが潰れない）', () => {
    expect(fitZoomIndex(0, 640)).toBe(DEFAULT_ZOOM_INDEX);
    expect(fitZoomIndex(10, 0)).toBe(DEFAULT_ZOOM_INDEX);
  });

  it('短い動画でも段より細かくはしない（いちばん大きい段で頭打ち）', () => {
    expect(fitZoomIndex(0.5, 4000)).toBe(ZOOM_LEVELS.length - 1);
  });
});

describe('stepZoomIndex（範囲の外へ出さない）', () => {
  it('端では止まる（押せるのに何も起きない、の材料にしない）', () => {
    expect(stepZoomIndex(0, -1)).toBe(0);
    expect(stepZoomIndex(ZOOM_LEVELS.length - 1, 1)).toBe(ZOOM_LEVELS.length - 1);
  });

  it('段を1つずつ動かす', () => {
    expect(stepZoomIndex(2, 1)).toBe(3);
    expect(stepZoomIndex(2, -1)).toBe(1);
  });
});

describe('zoomScrollLeft（錨点はマウス位置・決定13）', () => {
  /** 錨点の下にある時刻（列の名前の欄ぶんを引く＝実際の並びと同じ数え方）。 */
  const secAt = (scrollLeft: number, anchorPx: number, labelPx: number, px: number) =>
    (scrollLeft + anchorPx - labelPx) / px;

  it('錨点にある時刻が同じ場所に留まる（**列の名前の欄ぶんを引く**）', () => {
    const before = secAt(200, 100, 84, 40);
    const next = zoomScrollLeft({ scrollLeft: 200, anchorPx: 100, labelPx: 84, fromPxPerSec: 40, toPxPerSec: 80 });
    expect(secAt(next, 100, 84, 80)).toBeCloseTo(before, 10);
  });

  it('名前の欄が無いとき（0）も同じ式で解ける', () => {
    const next = zoomScrollLeft({ scrollLeft: 200, anchorPx: 100, labelPx: 0, fromPxPerSec: 40, toPxPerSec: 80 });
    expect((next + 100) / 80).toBeCloseTo(7.5, 10);
  });

  it('左端より前へは行かない（負のスクロールを作らない）', () => {
    expect(zoomScrollLeft({ scrollLeft: 0, anchorPx: 10, labelPx: 84, fromPxPerSec: 80, toPxPerSec: 16 })).toBe(0);
  });

  it('倍率が変わらなければ位置も変わらない', () => {
    expect(zoomScrollLeft({ scrollLeft: 123, anchorPx: 50, labelPx: 84, fromPxPerSec: 40, toPxPerSec: 40 })).toBeCloseTo(123, 10);
  });
});

describe('tickStepSec（目盛りは倍率で決める・#686 レビュー）', () => {
  it('広げるほど細かく、縮めるほど粗く（必要以上には粗くしない）', () => {
    expect(tickStepSec(120)).toBe(1);
    expect(tickStepSec(54)).toBe(1);
    expect(tickStepSec(24)).toBe(2);
    expect(tickStepSec(16)).toBe(5);
  });

  it('時計として読める刻みだけを使う（3秒や7秒を出さない）', () => {
    for (const px of ZOOM_LEVELS) expect([1, 2, 5, 10, 15, 30, 60]).toContain(tickStepSec(px));
  });

  it('どの段でも目盛りの間隔が読める幅に収まる（潰れない・消えない）', () => {
    for (const px of ZOOM_LEVELS) {
      const gap = tickStepSec(px) * px;
      expect(gap).toBeGreaterThanOrEqual(40); // 文字が重ならない
      expect(gap).toBeLessThanOrEqual(600); // 目印が消えない
    }
  });
});
