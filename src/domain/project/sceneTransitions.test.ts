import { describe, expect, it } from 'vitest';
import { deriveTransitionSelectValue, resolveBoundaryTransition, resolveTransition, transitionTimeline } from './sceneTransitions';

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
    expect(resolveTransition({ in: 'fade', durationSec: 1.2 }).durationSec).toBe(1.2);
  });
});

describe('deriveTransitionSelectValue（UI select 値・resolveTransition と一致）', () => {
  it('none/fade/slide:dir を返し、未設定は none', () => {
    expect(deriveTransitionSelectValue(undefined)).toBe('none');
    expect(deriveTransitionSelectValue({ in: 'none' })).toBe('none');
    expect(deriveTransitionSelectValue({ in: 'fade' })).toBe('fade');
    expect(deriveTransitionSelectValue({ in: 'slide', direction: 'up' })).toBe('slide:up');
    expect(deriveTransitionSelectValue({ in: 'slide' })).toBe('slide:left'); // 既定方向
  });

  it('wipe/zoom は fade として表示（書き出し実効値と一致＝UI と乖離させない）', () => {
    expect(deriveTransitionSelectValue({ in: 'wipe' })).toBe('fade');
    expect(deriveTransitionSelectValue({ in: 'zoom' })).toBe('fade');
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

describe('resolveBoundaryTransition（#408 Part 2・プレビュー用の境界解決）', () => {
  it('直前場面が無い（先頭）＝durationSec 0（プレビューしない）', () => {
    expect(resolveBoundaryTransition({ in: 'fade', durationSec: 0.5 }, undefined, 8)).toEqual({
      type: 'fade', direction: 'left', durationSec: 0,
    });
  });

  it('type=none＝durationSec 0（プレビューしない）', () => {
    expect(resolveBoundaryTransition({ in: 'none' }, 8, 8).durationSec).toBe(0);
  });

  it('fade は希望 D をそのまま（両場面尺内なら clamp なし）＝書き出しと同じ実効値', () => {
    expect(resolveBoundaryTransition({ in: 'fade', durationSec: 0.5 }, 8, 10)).toEqual({
      type: 'fade', direction: 'left', durationSec: 0.5,
    });
  });

  it('slide の方向を保つ・希望 D を返す', () => {
    expect(resolveBoundaryTransition({ in: 'slide', direction: 'up', durationSec: 0.8 }, 8, 8)).toEqual({
      type: 'slide', direction: 'up', durationSec: 0.8,
    });
  });

  it('極短場面では D を両隣の尺で clamp（書き出しと同じ）', () => {
    // 希望 5 だが prev=3 → D=min(5,3,10)=3。
    expect(resolveBoundaryTransition({ in: 'fade', durationSec: 5 }, 3, 10).durationSec).toBe(3);
  });

  it('wipe/zoom は fade に丸める（resolveTransition と一致）', () => {
    expect(resolveBoundaryTransition({ in: 'zoom', durationSec: 0.5 }, 8, 8).type).toBe('fade');
  });
});
