import { describe, expect, it } from 'vitest';
import type { Transition } from './types';
import { resolveTransition, transitionTimeline } from './sceneTransitions';

describe('resolveTransition', () => {
  it('未設定は none / 既定方向 left / 既定 0.5 秒', () => {
    expect(resolveTransition(undefined)).toEqual({ type: 'none', direction: 'left', durationSec: 0.5 });
  });

  it('fade はそのまま', () => {
    expect(resolveTransition({ in: 'fade' })).toMatchObject({ type: 'fade' });
  });

  it('slide は direction を反映（未指定は left）', () => {
    expect(resolveTransition({ in: 'slide', direction: 'up' })).toMatchObject({ type: 'slide', direction: 'up' });
    expect(resolveTransition({ in: 'slide' }).direction).toBe('left');
  });

  it('wipe/zoom は MVP 未対応のため fade にフォールバック', () => {
    expect(resolveTransition({ in: 'wipe' }).type).toBe('fade');
    expect(resolveTransition({ in: 'zoom' }).type).toBe('fade');
  });

  it('durationSec は 0 以上に丸める', () => {
    expect(resolveTransition({ in: 'fade', durationSec: -1 }).durationSec).toBe(0);
    expect(resolveTransition({ in: 'fade', durationSec: 1.2 } as Transition).durationSec).toBe(1.2);
  });
});

describe('transitionTimeline', () => {
  it('空・単一場面は遷移なし', () => {
    expect(transitionTimeline([], [])).toEqual({ effectiveTotalSec: 0, steps: [] });
    expect(transitionTimeline([8], [0])).toEqual({ effectiveTotalSec: 8, steps: [] });
  });

  it('2場面：offset=累積−D、総尺=Σ尺−ΣD', () => {
    const r = transitionTimeline([8, 10], [0, 2]);
    expect(r.steps).toEqual([{ offsetSec: 6, durationSec: 2 }]);
    expect(r.effectiveTotalSec).toBe(16);
  });

  it('3場面：offset は実効累積を基準に進む', () => {
    const r = transitionTimeline([8, 10, 6], [0, 2, 1]);
    expect(r.steps).toEqual([
      { offsetSec: 6, durationSec: 2 }, // acc 8 → 16
      { offsetSec: 15, durationSec: 1 }, // acc 16 → 21
    ]);
    expect(r.effectiveTotalSec).toBe(21);
  });

  it('D=0（none）は単純連結（offset=累積・総尺=Σ尺）', () => {
    const r = transitionTimeline([8, 10], [0, 0]);
    expect(r.steps).toEqual([{ offsetSec: 8, durationSec: 0 }]);
    expect(r.effectiveTotalSec).toBe(18);
  });

  it('極短場面：D は左右どちらの尺も超えないよう clamp', () => {
    // D 希望 5 だが両場面とも 3 → d=3、offset=0、総尺=3+3-3=3
    const r = transitionTimeline([3, 3], [0, 5]);
    expect(r.steps).toEqual([{ offsetSec: 0, durationSec: 3 }]);
    expect(r.effectiveTotalSec).toBe(3);
  });
});
