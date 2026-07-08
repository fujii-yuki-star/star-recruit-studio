import { describe, expect, it } from 'vitest';
import { opacityToPercent, percentToOpacity } from './opacity';

describe('opacity 単位変換（#459 item5）', () => {
  it('0〜1 → 濃さ(%) 0〜100（整数丸め）', () => {
    expect(opacityToPercent(0)).toBe(0);
    expect(opacityToPercent(0.55)).toBe(55);
    expect(opacityToPercent(1)).toBe(100);
    expect(opacityToPercent(0.333)).toBe(33);
  });

  it('濃さ(%) 0〜100 → 0〜1（範囲外はクランプ）', () => {
    expect(percentToOpacity(0)).toBe(0);
    expect(percentToOpacity(55)).toBeCloseTo(0.55, 5);
    expect(percentToOpacity(100)).toBe(1);
    expect(percentToOpacity(150)).toBe(1); // 上限クランプ
    expect(percentToOpacity(-10)).toBe(0); // 下限クランプ
  });

  it('往復で値が保たれる（整数%の範囲）', () => {
    for (const pct of [0, 25, 50, 75, 100]) {
      expect(opacityToPercent(percentToOpacity(pct))).toBe(pct);
    }
  });
});
