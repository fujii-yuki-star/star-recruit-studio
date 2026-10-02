// 読み上げの速さの見積もりを、声の速さ設定とつなぐ（#1318）。
import { describe, expect, it } from 'vitest';
import { NARRATION_CHARS_PER_SEC } from '../constants';
import { narrationCharsPerSec } from './speechRate';

describe('narrationCharsPerSec', () => {
  it('速さ 1.0（ふつう）・未指定は基準の字数', () => {
    expect(narrationCharsPerSec(1)).toBe(NARRATION_CHARS_PER_SEC);
    expect(narrationCharsPerSec(undefined)).toBe(NARRATION_CHARS_PER_SEC);
    expect(narrationCharsPerSec(null)).toBe(NARRATION_CHARS_PER_SEC);
  });
  it('速さの倍率で増減する', () => {
    expect(narrationCharsPerSec(1.2)).toBeCloseTo(NARRATION_CHARS_PER_SEC * 1.2);
    expect(narrationCharsPerSec(0.8)).toBeCloseTo(NARRATION_CHARS_PER_SEC * 0.8);
  });
  it('0 以下・数でないときは 1.0 として扱う', () => {
    for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(narrationCharsPerSec(v)).toBe(NARRATION_CHARS_PER_SEC);
  });
});
