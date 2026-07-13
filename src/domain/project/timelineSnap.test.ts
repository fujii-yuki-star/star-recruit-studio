import { describe, expect, it } from 'vitest';
import { snapTimeSec } from './timelineSnap';

describe('snapTimeSec', () => {
  it('しきい値内の最も近い target へ吸着する', () => {
    // 5.2 は 5（距離0.2）と 6（距離0.8）のうち近い 5 へ。
    expect(snapTimeSec(5.2, [0, 5, 6, 10], 0.5)).toBe(5);
  });

  it('しきい値ちょうどの距離でも吸着する（境界は含む）', () => {
    expect(snapTimeSec(5.5, [5], 0.5)).toBe(5);
  });

  it('どの target もしきい値外なら値のまま', () => {
    expect(snapTimeSec(5.9, [0, 5, 7], 0.5)).toBe(5.9);
  });

  it('複数が範囲内なら距離の近い方を選ぶ', () => {
    // 5.4：5（0.4）と 5.6（0.2）の両方が範囲内 → 近い 5.6。
    expect(snapTimeSec(5.4, [5, 5.6], 0.5)).toBe(5.6);
  });

  it('targets が空なら値のまま', () => {
    expect(snapTimeSec(3, [], 0.5)).toBe(3);
  });

  it('threshold 0 は完全一致のみ吸着（実質吸着なし）', () => {
    expect(snapTimeSec(5.0, [5, 6], 0)).toBe(5);
    expect(snapTimeSec(5.01, [5, 6], 0)).toBe(5.01);
  });
});
