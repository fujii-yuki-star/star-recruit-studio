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

describe('slideInKeyframes（すべって・相対オフセット）', () => {
  it('左からは開始 x=−距離・終点 x=0（本来位置からのオフセット＝要素位置に依らない）＋フェード', () => {
    const kfs = slideInKeyframes(el(), 'left', 0.6);
    expect(kfs[0]).toMatchObject({ x: -SLIDE_DISTANCE, opacity: 0 });
    expect(kfs[1]).toMatchObject({ x: 0, opacity: 1, easing: EASING.easeInOut });
    expect(kfs[0].y).toBeUndefined(); // 横スライドは y を持たない
  });
  it('右からは開始 x=＋距離', () => {
    expect(slideInKeyframes(el(), 'right', 0.6)[0].x).toBe(SLIDE_DISTANCE);
  });
  it('上下は y オフセット（下からは＋距離）', () => {
    expect(slideInKeyframes(el(), 'up', 0.6)[0].y).toBe(-SLIDE_DISTANCE);
    expect(slideInKeyframes(el(), 'down', 0.6)[0].y).toBe(SLIDE_DISTANCE);
  });
});

describe('popInKeyframes（ぽん・係数のみ）', () => {
  it('小さく→等倍・x/y は焼き込まない（layout が中心維持）＋フェード', () => {
    const kfs = popInKeyframes(el(), 0.6);
    expect(kfs[0]).toMatchObject({ scale: POP_START_SCALE, opacity: 0 });
    expect(kfs[0].x).toBeUndefined();
    expect(kfs[1]).toMatchObject({ scale: 1, opacity: 1 });
  });
});

describe('spinInKeyframes（くるっと・相対角度）', () => {
  it('本来角度からのオフセット（SPIN_START→0）＋フェード＝要素角度に依らない', () => {
    const kfs = spinInKeyframes(el({ rotation: 30 }), 0.6);
    expect(kfs[0]).toMatchObject({ rotation: SPIN_START_DEG, opacity: 0 });
    expect(kfs[1]).toMatchObject({ rotation: 0, opacity: 1 });
  });
});

describe('presetKeyframes（単一入口）／describeAnimation（導出）', () => {
  const kinds = ['fade', 'slide', 'pop', 'spin'] as const;
  it('種類ごとに主プロパティを含み、describeAnimation で種類/秒/イージングを復元（往復）', () => {
    for (const kind of kinds) {
      const kfs = presetKeyframes(kind, el({ opacity: 1 }), { durationSec: 0.8, easing: EASING.linear, direction: 'right' });
      const d = describeAnimation(kfs);
      expect(d.kind).toBe(kind);
      expect(d.durationSec).toBe(0.8);
      expect(d.easing).toBe(EASING.linear);
    }
  });
  it('スライドの向きをオフセット符号から復元する（要素位置に依らない）', () => {
    expect(describeAnimation(presetKeyframes('slide', el(), { durationSec: 0.6, easing: EASING.easeInOut, direction: 'down' })).direction).toBe('down');
    expect(describeAnimation(presetKeyframes('slide', el(), { durationSec: 0.6, easing: EASING.easeInOut, direction: 'right' })).direction).toBe('right');
  });
  it('空は kind=null', () => {
    expect(describeAnimation([]).kind).toBeNull();
  });
});

describe('presetDurationSec / withEndOpacity', () => {
  it('presetDurationSec は末尾KFの timeSec（空は既定）', () => {
    expect(presetDurationSec(slideInKeyframes(el(), 'left', 1.2))).toBe(1.2);
    expect(presetDurationSec([])).toBe(PRESET_DEFAULT_SEC);
  });
  it('withEndOpacity は終点の不透明度だけ差し替え、種類（x 等）は保つ', () => {
    const kfs = slideInKeyframes(el(), 'left', 0.6); // 終点に opacity と x=0 を持つ
    const next = withEndOpacity(kfs, 0.4);
    expect(next[1].opacity).toBe(0.4);
    expect(next[1].x).toBe(0); // オフセット（種類）は不変
    expect(next[0].opacity).toBe(0); // 開始は 0 のまま
  });
});
