import { describe, expect, it } from 'vitest';
import { formatDuration } from './duration';

describe('formatDuration（#411）', () => {
  it('浮動小数の尾を 0.1 秒に丸める（合算誤差を出さない）', () => {
    expect(formatDuration(6.300000000000001)).toBe('6.3秒');
  });
  it('整数秒は小数を付けない', () => {
    expect(formatDuration(8)).toBe('8秒');
  });
  it('60秒以上は「X分Y秒」', () => {
    expect(formatDuration(90.3)).toBe('1分30.3秒');
    expect(formatDuration(120)).toBe('2分0秒');
  });
  it('負値は 0 秒扱い', () => {
    expect(formatDuration(-5)).toBe('0秒');
  });
});
