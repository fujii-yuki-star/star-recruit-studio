import { describe, expect, it } from 'vitest';
import { fadeInKeyframes, fadeInDurationOf, FADE_IN_DEFAULT_SEC, FADE_IN_MIN_SEC, FADE_IN_MAX_SEC } from './animationPresets';
import { EASING } from '../enums';

describe('fadeInKeyframes（④・ADR-0019 (1c) フェードイン）', () => {
  it('不透明度 0→endOpacity の2KF・終点KFにイージング（ease-in-out）', () => {
    const kfs = fadeInKeyframes(1, 0.6);
    expect(kfs).toEqual([
      { timeSec: 0, opacity: 0 },
      { timeSec: 0.6, opacity: 1, easing: EASING.easeInOut },
    ]);
  });

  it('endOpacity は 0..1 にクランプ（図形の本来の不透明度をそのまま渡せる）', () => {
    expect(fadeInKeyframes(0.5, 1)[1].opacity).toBe(0.5);
    expect(fadeInKeyframes(1.5, 1)[1].opacity).toBe(1);
    expect(fadeInKeyframes(-1, 1)[1].opacity).toBe(0);
  });

  it('所要秒は範囲にクランプ（簡易操作の下限/上限）', () => {
    expect(fadeInKeyframes(1, 0)[1].timeSec).toBe(FADE_IN_MIN_SEC);
    expect(fadeInKeyframes(1, 999)[1].timeSec).toBe(FADE_IN_MAX_SEC);
  });
});

describe('fadeInDurationOf', () => {
  it('末尾KFの timeSec を返す（現在の所要秒の表示に使う）', () => {
    expect(fadeInDurationOf(fadeInKeyframes(1, 1.2))).toBe(1.2);
  });
  it('空なら既定', () => {
    expect(fadeInDurationOf([])).toBe(FADE_IN_DEFAULT_SEC);
  });
});
