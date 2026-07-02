import { describe, expect, it } from 'vitest';
import { interpolateKeyframes } from './keyframes';
import type { Keyframe } from './types';

describe('interpolateKeyframes（④・ADR-0019）', () => {
  it('線形補間：フェード（opacity 0→1）を中間で 0.5', () => {
    const kfs: Keyframe[] = [{ timeSec: 0, opacity: 0 }, { timeSec: 2, opacity: 1 }];
    expect(interpolateKeyframes(kfs, 0)).toEqual({ opacity: 0 });
    expect(interpolateKeyframes(kfs, 1)).toEqual({ opacity: 0.5 });
    expect(interpolateKeyframes(kfs, 2)).toEqual({ opacity: 1 });
  });
  it('区間外は端でクランプ（前は最初の値・後は最後の値）', () => {
    const kfs: Keyframe[] = [{ timeSec: 1, x: 10 }, { timeSec: 3, x: 30 }];
    expect(interpolateKeyframes(kfs, 0)).toEqual({ x: 10 }); // 最初の前
    expect(interpolateKeyframes(kfs, 5)).toEqual({ x: 30 }); // 最後の後
  });
  it('ease-in-out：raw=0.25 で 0.125（緩急がつく）', () => {
    const kfs: Keyframe[] = [{ timeSec: 0, x: 0 }, { timeSec: 2, x: 100, easing: 'ease-in-out' }];
    // t=0.5 → raw=0.25 → ease=2*0.25^2=0.125 → x=12.5。t=1 → raw=0.5 → ease=0.5 → x=50。
    expect(interpolateKeyframes(kfs, 0.5)).toEqual({ x: 12.5 });
    expect(interpolateKeyframes(kfs, 1)).toEqual({ x: 50 });
  });
  it('プロパティは独立に補間（それぞれ該当KFだけで）', () => {
    const kfs: Keyframe[] = [
      { timeSec: 0, x: 0, opacity: 1 },
      { timeSec: 2, x: 100 },
      { timeSec: 4, opacity: 0 },
    ];
    // t=2：x は最後の x-KF(t2)＝100。opacity は t0(1)→t4(0) の中間 raw=0.5 → 0.5。
    expect(interpolateKeyframes(kfs, 2)).toEqual({ x: 100, opacity: 0.5 });
  });
  it('空／該当プロパティ無しは undefined（＝基準値のまま）', () => {
    expect(interpolateKeyframes([], 1)).toEqual({});
    expect(interpolateKeyframes([{ timeSec: 0, x: 5 }], 0)).toEqual({ x: 5 }); // opacity 等は付かない
  });
});
