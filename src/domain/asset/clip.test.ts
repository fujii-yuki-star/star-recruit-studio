import { describe, expect, it } from 'vitest';
import { clampClipTime, clampSpeed } from './clip';
import { SPEED_DEFAULT, SPEED_MAX, SPEED_MIN } from '../constants';

describe('clampClipTime', () => {
  it('[0, max] に収める', () => {
    expect(clampClipTime(5, 10)).toBe(5);
    expect(clampClipTime(-2, 10)).toBe(0);
    expect(clampClipTime(12, 10)).toBe(10);
  });
  it('max 不明なら上限なし（下限0）', () => {
    expect(clampClipTime(999)).toBe(999);
    expect(clampClipTime(-1)).toBe(0);
  });
  it('min 指定（終了は開始以上にする等）', () => {
    expect(clampClipTime(3, 10, 5)).toBe(5);
    expect(clampClipTime(8, 10, 5)).toBe(8);
  });
  it('NaN・非有限は min（無効入力は下限へ）', () => {
    expect(clampClipTime(NaN, 10)).toBe(0);
    expect(clampClipTime(Infinity, 10, 4)).toBe(4);
    expect(clampClipTime(NaN, 10, 4)).toBe(4);
  });
  it('min > max のときは max が優先（絶対上限。呼び出し側は min ≤ max 前提）', () => {
    expect(clampClipTime(4, 3, 5)).toBe(3);
  });
});

describe('clampSpeed', () => {
  it('[SPEED_MIN, SPEED_MAX] に収める', () => {
    expect(clampSpeed(1.25)).toBe(1.25);
    expect(clampSpeed(0.1)).toBe(SPEED_MIN);
    expect(clampSpeed(5)).toBe(SPEED_MAX);
  });
  it('NaN・非有限は SPEED_DEFAULT', () => {
    expect(clampSpeed(NaN)).toBe(SPEED_DEFAULT);
    expect(clampSpeed(Infinity)).toBe(SPEED_DEFAULT);
  });
});
