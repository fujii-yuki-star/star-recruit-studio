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

  // #408 Part 2 レビュー P3：単境界（prev, B）clamp が、書き出しの全場面 transitionTimeline（左 clamp=累積結合尺 acc）
  // と 3 場面以上でも一致することを固定する。acc≥prev（結合尺は最後の場面尺以上）ゆえ、左 clamp が実効値を変えるのは
  // 希望 D>prev のときだけ＝有効な場面尺（≥3・D 既定 0.5）では常に一致（パリティ）。
  describe('3 場面以上でも書き出しの累積 clamp と一致（P3 不変条件）', () => {
    it('D≤prev なら単境界＝書き出し累積（境界 i の step と一致・大きめ D 含む）', () => {
      const durations = [5, 4, 6]; // すべて SCENE_MIN_DURATION_SEC=3 以上
      for (const D of [0.5, 2, 4]) {
        // 境界 i（scene i に入る遷移）ごとに、全場面 timeline の step[i-1] と単境界解決を突き合わせる。
        const full = transitionTimeline(durations, durations.map((_, i) => (i === 0 ? 0 : D)));
        for (let i = 1; i < durations.length; i += 1) {
          const single = resolveBoundaryTransition({ in: 'fade', durationSec: D }, durations[i - 1], durations[i]);
          expect(single.durationSec).toBe(full.steps[i - 1].durationSec);
        }
      }
    });

    it('（反例）希望 D>prev のときだけ単境界＜累積になり得る＝有効尺（≥3・既定0.5）では到達不能', () => {
      // scene2 に D=5 を入れると prev=4<5 で binding。単境界は min(5,4,6)=4、累積は acc=7 で min(5,7,6)=5。
      const full = transitionTimeline([5, 4, 6], [0, 0, 5]);
      const single = resolveBoundaryTransition({ in: 'fade', durationSec: 5 }, 4, 6);
      expect(single.durationSec).toBe(4);
      expect(full.steps[1].durationSec).toBe(5);
      // ＝D(5)>prev(4) の極端値でのみズレる。SCENE_MIN_DURATION_SEC=3・D 既定 0.5 では D≤prev ゆえ起きない。
    });
  });
});
