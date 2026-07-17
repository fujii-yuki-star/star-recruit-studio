import { describe, expect, it } from 'vitest';
import { GROUP_MIN_SCALE } from '../constants';
import { percentToScale, SCALE_PERCENT_MIN, scaleToPercent } from './scale';

describe('拡大率 単位変換（#554）', () => {
  it('拡大率 → 大きさ(%)（100=等倍・整数丸め）', () => {
    expect(scaleToPercent(1)).toBe(100);
    expect(scaleToPercent(0.5)).toBe(50);
    expect(scaleToPercent(2.5)).toBe(250);
    expect(scaleToPercent(0.333)).toBe(33);
  });

  it('大きさ(%) → 拡大率', () => {
    expect(percentToScale(100)).toBe(1);
    expect(percentToScale(50)).toBeCloseTo(0.5, 5);
    expect(percentToScale(250)).toBeCloseTo(2.5, 5);
  });

  it('上限は設けない＝ドラッグと同じ到達範囲（#554・ADR-0026②）', () => {
    // opacity と違い 100% で頭打ちにしない。ここが閉じると「ドラッグでは拡大できるのに数値では無理」になる。
    expect(percentToScale(1000)).toBeCloseTo(10, 5);
    expect(scaleToPercent(10)).toBe(1000);
  });

  it('下限は GROUP_MIN_SCALE でクランプ＝schema の scale>0 を満たす', () => {
    expect(percentToScale(0)).toBe(GROUP_MIN_SCALE);
    expect(percentToScale(-50)).toBe(GROUP_MIN_SCALE);
    expect(percentToScale(SCALE_PERCENT_MIN)).toBeCloseTo(GROUP_MIN_SCALE, 10);
    expect(percentToScale(0)).toBeGreaterThan(0); // exclusiveMinimum: 0（project.schema $defs/Group）
  });

  it('SCALE_PERCENT_MIN は GROUP_MIN_SCALE と往復する（入力欄の min が下限と一致）', () => {
    expect(scaleToPercent(GROUP_MIN_SCALE)).toBe(SCALE_PERCENT_MIN);
  });

  it('NaN/Infinity は等倍へ倒す（欄が壊れた値を保存しない）', () => {
    expect(scaleToPercent(Number.NaN)).toBe(100);
    expect(percentToScale(Number.NaN)).toBe(1);
    expect(percentToScale(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('往復で値が保たれる（整数%の範囲）', () => {
    for (const pct of [1, 25, 50, 100, 150, 400]) {
      expect(scaleToPercent(percentToScale(pct))).toBe(pct);
    }
  });
});
