import { describe, expect, it } from 'vitest';
import {
  fadeInKeyframes, slideInKeyframes, popInKeyframes, spinInKeyframes,
  presetKeyframes, presetDurationSec, withEndOpacity, describeAnimation,
  PRESET_DEFAULT_SEC, PRESET_MIN_SEC, PRESET_MAX_SEC, SLIDE_DISTANCE, POP_START_SCALE, SPIN_START_DEG,
} from './animationPresets';
import { EASING } from '../enums';
import type { FreeElement } from './types';

const el = (over: Partial<FreeElement> = {}): FreeElement =>
  ({ id: 'free_001', kind: 'shape', x: 100, y: 50, w: 200, h: 80, ...over } as FreeElement);

describe('fadeInKeyframes（④・ADR-0019 フェードイン）', () => {
  it('不透明度 0→endOpacity の2KF・終点KFにイージング（既定 ease-in-out）', () => {
    expect(fadeInKeyframes(1, 0.6)).toEqual([
      { timeSec: 0, opacity: 0 },
      { timeSec: 0.6, opacity: 1, easing: EASING.easeInOut },
    ]);
  });
  it('イージングを指定できる（一定＝linear）', () => {
    expect(fadeInKeyframes(1, 0.6, EASING.linear)[1].easing).toBe(EASING.linear);
  });
  it('endOpacity は 0..1・所要秒は範囲にクランプ', () => {
    expect(fadeInKeyframes(1.5, 999)[1]).toMatchObject({ opacity: 1, timeSec: PRESET_MAX_SEC });
    expect(fadeInKeyframes(-1, 0)[1]).toMatchObject({ opacity: 0, timeSec: PRESET_MIN_SEC });
  });
});

describe('slideInKeyframes（すべって）', () => {
  it('左からは開始 x が本来位置−距離、終点は本来位置＋フェード', () => {
    const kfs = slideInKeyframes(el(), 'left', 0.6);
    expect(kfs[0]).toMatchObject({ x: 100 - SLIDE_DISTANCE, y: 50, opacity: 0 });
    expect(kfs[1]).toMatchObject({ x: 100, y: 50, opacity: 1, easing: EASING.easeInOut });
  });
  it('上下は y を動かす（下からは開始 y が本来＋距離）', () => {
    expect(slideInKeyframes(el(), 'up', 0.6)[0].y).toBe(50 - SLIDE_DISTANCE);
    expect(slideInKeyframes(el(), 'down', 0.6)[0].y).toBe(50 + SLIDE_DISTANCE);
  });
});

describe('popInKeyframes（ぽん）', () => {
  it('小さく→等倍・中心維持のため左上を補正', () => {
    const kfs = popInKeyframes(el(), 0.6);
    expect(kfs[0]).toMatchObject({ scale: POP_START_SCALE, opacity: 0 });
    expect(kfs[0].x).toBeCloseTo(100 + (200 * (1 - POP_START_SCALE)) / 2);
    expect(kfs[1]).toMatchObject({ scale: 1, x: 100, y: 50, opacity: 1 });
  });
});

describe('spinInKeyframes（くるっと）', () => {
  it('初期角度（本来＋SPIN_START）から本来角度へ＋フェード', () => {
    const kfs = spinInKeyframes(el({ rotation: 30 }), 0.6);
    expect(kfs[0]).toMatchObject({ rotation: 30 + SPIN_START_DEG, opacity: 0 });
    expect(kfs[1]).toMatchObject({ rotation: 30, opacity: 1 });
  });
});

describe('presetKeyframes（単一入口）／describeAnimation（導出）', () => {
  const kinds = [
    { kind: 'fade' as const, prop: 'opacity' },
    { kind: 'slide' as const, prop: 'x' },
    { kind: 'pop' as const, prop: 'scale' },
    { kind: 'spin' as const, prop: 'rotation' },
  ];
  it('種類ごとに主プロパティを含み、describeAnimation で種類を復元できる（往復）', () => {
    for (const { kind } of kinds) {
      const kfs = presetKeyframes(kind, el({ opacity: 1 }), { durationSec: 0.8, easing: EASING.linear, direction: 'right' });
      const d = describeAnimation(kfs, el({ opacity: 1 }));
      expect(d.kind).toBe(kind);
      expect(d.durationSec).toBe(0.8);
      expect(d.easing).toBe(EASING.linear);
    }
  });
  it('スライドの向きを開始位置から復元する', () => {
    const kfs = presetKeyframes('slide', el(), { durationSec: 0.6, easing: EASING.easeInOut, direction: 'down' });
    expect(describeAnimation(kfs, el()).direction).toBe('down');
  });
  it('空は kind=null', () => {
    expect(describeAnimation([], el()).kind).toBeNull();
  });
});

describe('presetDurationSec / withEndOpacity', () => {
  it('presetDurationSec は末尾KFの timeSec（空は既定）', () => {
    expect(presetDurationSec(slideInKeyframes(el(), 'left', 1.2))).toBe(1.2);
    expect(presetDurationSec([])).toBe(PRESET_DEFAULT_SEC);
  });
  it('withEndOpacity は終点の不透明度だけ差し替え、種類（x/scale 等）は保つ', () => {
    const kfs = slideInKeyframes(el(), 'left', 0.6); // 終点に opacity と x を持つ
    const next = withEndOpacity(kfs, 0.4);
    expect(next[1].opacity).toBe(0.4);
    expect(next[1].x).toBe(kfs[1].x); // 位置（種類）は不変
    expect(next[0].opacity).toBe(0); // 開始は 0 のまま
  });
});
