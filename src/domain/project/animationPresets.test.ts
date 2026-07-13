import { describe, expect, it } from 'vitest';
import {
  fadeInKeyframes, slideInKeyframes, popInKeyframes, spinInKeyframes,
  presetKeyframes, presetDurationSec, withEndOpacity, describeAnimation,
  PRESET_DEFAULT_SEC, PRESET_MIN_SEC, PRESET_MAX_SEC, SLIDE_DISTANCE, POP_START_SCALE, SPIN_START_DEG,
} from './animationPresets';
import { EASING } from '../enums';

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

describe('slideInKeyframes（すべって・相対オフセット・el 非依存）', () => {
  it('左からは開始 x=−距離・終点 x=0＋フェード（endOpacity 既定1）', () => {
    const kfs = slideInKeyframes('left', 0.6);
    expect(kfs[0]).toMatchObject({ x: -SLIDE_DISTANCE, opacity: 0 });
    expect(kfs[1]).toMatchObject({ x: 0, opacity: 1, easing: EASING.easeInOut });
    expect(kfs[0].y).toBeUndefined();
  });
  it('向きでオフセット軸/符号が変わる（右=+x／上=-y／下=+y）', () => {
    expect(slideInKeyframes('right', 0.6)[0].x).toBe(SLIDE_DISTANCE);
    expect(slideInKeyframes('up', 0.6)[0].y).toBe(-SLIDE_DISTANCE);
    expect(slideInKeyframes('down', 0.6)[0].y).toBe(SLIDE_DISTANCE);
  });
  it('endOpacity を終点に反映（要素の本来不透明度を渡せる）', () => {
    expect(slideInKeyframes('left', 0.6, EASING.linear, 0.5)[1].opacity).toBe(0.5);
  });
});

describe('popInKeyframes（ぽん・係数のみ）／spinInKeyframes（くるっと・相対角度）', () => {
  it('pop は小さく→等倍・x/y 焼き込みなし', () => {
    const kfs = popInKeyframes(0.6);
    expect(kfs[0]).toMatchObject({ scale: POP_START_SCALE, opacity: 0 });
    expect(kfs[0].x).toBeUndefined();
    expect(kfs[1]).toMatchObject({ scale: 1, opacity: 1 });
  });
  it('spin は本来角度からのオフセット（SPIN_START→0）＋フェード', () => {
    const kfs = spinInKeyframes(0.6);
    expect(kfs[0]).toMatchObject({ rotation: SPIN_START_DEG, opacity: 0 });
    expect(kfs[1]).toMatchObject({ rotation: 0, opacity: 1 });
  });
});

describe('presetKeyframes（単一入口・el 不要）／describeAnimation（導出）', () => {
  const kinds = ['fade', 'slide', 'pop', 'spin'] as const;
  it('種類ごとに主プロパティを含み、describeAnimation で種類/秒/イージングを復元（往復）', () => {
    for (const kind of kinds) {
      const kfs = presetKeyframes(kind, { durationSec: 0.8, easing: EASING.linear, direction: 'right', endOpacity: 1 });
      const d = describeAnimation(kfs);
      expect(d.kind).toBe(kind);
      expect(d.durationSec).toBe(0.8);
      expect(d.easing).toBe(EASING.linear);
    }
  });
  it('endOpacity 省略時は 1（グループ用）', () => {
    expect(presetKeyframes('fade', { durationSec: 0.6, easing: EASING.easeInOut })[1].opacity).toBe(1);
  });
  it('スライドの向きをオフセット符号から復元する', () => {
    expect(describeAnimation(presetKeyframes('slide', { durationSec: 0.6, easing: EASING.easeInOut, direction: 'down' })).direction).toBe('down');
    expect(describeAnimation(presetKeyframes('slide', { durationSec: 0.6, easing: EASING.easeInOut, direction: 'right' })).direction).toBe('right');
  });
  it('空は kind=null', () => {
    expect(describeAnimation([]).kind).toBeNull();
  });
});

describe('presetDurationSec / withEndOpacity', () => {
  it('presetDurationSec は末尾KFの timeSec（空は既定）', () => {
    expect(presetDurationSec(slideInKeyframes('left', 1.2))).toBe(1.2);
    expect(presetDurationSec([])).toBe(PRESET_DEFAULT_SEC);
  });
  it('withEndOpacity は終点の不透明度だけ差し替え、種類（x 等）は保つ', () => {
    const kfs = slideInKeyframes('left', 0.6);
    const next = withEndOpacity(kfs, 0.4);
    expect(next[1].opacity).toBe(0.4);
    expect(next[1].x).toBe(0);
    expect(next[0].opacity).toBe(0);
  });
});
