import { describe, expect, it } from 'vitest';
import {
  INTONATION_RANGE, PITCH_RANGE, SPEED_RANGE, sliderToValue, valueToSlider,
} from './voiceParams';

describe('sliderToValue（0→min / 50→def / 100→max）', () => {
  it('speed: 0.5–2.0、50で既定1.0', () => {
    expect(sliderToValue(0, SPEED_RANGE)).toBe(0.5);
    expect(sliderToValue(50, SPEED_RANGE)).toBe(1.0);
    expect(sliderToValue(100, SPEED_RANGE)).toBe(2.0);
  });
  it('pitch: -1.0–1.0、50で既定0.0', () => {
    expect(sliderToValue(0, PITCH_RANGE)).toBe(-1.0);
    expect(sliderToValue(50, PITCH_RANGE)).toBe(0.0);
    expect(sliderToValue(100, PITCH_RANGE)).toBe(1.0);
  });
  it('intonation: 0.0–2.0、50で既定1.0', () => {
    expect(sliderToValue(0, INTONATION_RANGE)).toBe(0.0);
    expect(sliderToValue(50, INTONATION_RANGE)).toBe(1.0);
    expect(sliderToValue(100, INTONATION_RANGE)).toBe(2.0);
  });
  it('範囲外スライダーはクランプする', () => {
    expect(sliderToValue(-10, SPEED_RANGE)).toBe(0.5);
    expect(sliderToValue(999, SPEED_RANGE)).toBe(2.0);
  });
});

describe('valueToSlider（min→0 / def→50 / max→100）', () => {
  it('既定値はスライダー中央(50)', () => {
    expect(valueToSlider(1.0, SPEED_RANGE)).toBe(50);
    expect(valueToSlider(0.0, PITCH_RANGE)).toBe(50);
    expect(valueToSlider(1.0, INTONATION_RANGE)).toBe(50);
  });
  it('端は0/100', () => {
    expect(valueToSlider(0.5, SPEED_RANGE)).toBe(0);
    expect(valueToSlider(2.0, SPEED_RANGE)).toBe(100);
  });
});

describe('往復（slider→value→slider）', () => {
  it('代表点で一致する', () => {
    for (const s of [0, 25, 50, 75, 100]) {
      expect(valueToSlider(sliderToValue(s, SPEED_RANGE), SPEED_RANGE)).toBe(s);
      expect(valueToSlider(sliderToValue(s, PITCH_RANGE), PITCH_RANGE)).toBe(s);
    }
  });
});
