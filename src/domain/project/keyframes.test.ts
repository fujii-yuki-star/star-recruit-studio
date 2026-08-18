import { describe, expect, it } from 'vitest';
import { applyEasing, interpolateKeyframes, isLinearCurve, splitEasingCurve } from './keyframes';
import type { BezierEasing } from '../enums';
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
  it('timeSec が昇順でなくても正しく補間する（防御ソート）', () => {
    const kfs: Keyframe[] = [{ timeSec: 2, x: 100 }, { timeSec: 0, x: 0 }]; // 逆順入力
    expect(interpolateKeyframes(kfs, 1)).toEqual({ x: 50 });
  });
});

// 動き方（カーブ）を進捗で2つに切る（#753）。分けた帯の前後で軌跡を保つための材料。
describe('splitEasingCurve（動き方を切る・#753）', () => {
  it('切った前後をつなぐと元の進み具合に戻る', () => {
    const easing: BezierEasing = { bezier: [0.2, 1.4, 0.9, 0.1] };
    const atX = 0.35;
    const r = splitEasingCurve(easing, atX);
    expect(r).not.toBeNull();
    const { head, tail } = r as { head: [number, number, number, number]; tail: [number, number, number, number] };
    const sy = applyEasing(atX, easing);
    for (let i = 0; i <= 20; i += 1) {
      const x = i / 20;
      // 前半＝[0,atX] を [0,1] へ伸ばした形／後半＝[atX,1] を同じく伸ばした形。
      expect(applyEasing(x, { bezier: head }) * sy).toBeCloseTo(applyEasing(x * atX, easing), 4);
      expect(sy + applyEasing(x, { bezier: tail }) * (1 - sy)).toBeCloseTo(
        applyEasing(atX + x * (1 - atX), easing), 4,
      );
    }
  });

  it('直線を切ると「進み具合を変えない」形になる（制御点は対角線上）', () => {
    const r = splitEasingCurve('linear', 0.4);
    expect(r).not.toBeNull();
    const { head, tail } = r as { head: [number, number, number, number]; tail: [number, number, number, number] };
    // ⚠️ `[0,0,1,1]` には戻らない（媒介変数が付け替わる）＝**対角線上か**で見る。
    expect(isLinearCurve(head)).toBe(true);
    expect(isLinearCurve(tail)).toBe(true);
  });

  it('「両端ゆっくり」は3次ベジェで表せないので切らない（近い形で置き換えない）', () => {
    expect(splitEasingCurve('ease-in-out', 0.4)).toBeNull();
  });

  it('区間の外・端では切らない（切れ目の無い所で形を作らない）', () => {
    expect(splitEasingCurve('ease-in', 0)).toBeNull();
    expect(splitEasingCurve('ease-in', 1)).toBeNull();
    expect(splitEasingCurve('ease-in', 1.2)).toBeNull();
  });

  // ⚠️ **返すのは「表せない（null）」か、そのまま `Keyframe.easing` に書ける値だけ**＝
  // `x` は 0〜1（正典 `11 §7.6`・schema）で、割り算が壊れた値（NaN・∞）を混ぜない。
  it('どんな形・どこで切っても、そのまま書ける値しか返さない', () => {
    for (const y1 of [-2, -0.5, 0, 0.5, 1, 1.5, 3]) {
      for (const y2 of [-2, -0.5, 0, 0.5, 1, 1.5, 3]) {
        for (const x of [0.05, 0.2, 0.5, 0.8, 0.95]) {
          const r = splitEasingCurve({ bezier: [0.25, y1, 0.75, y2] }, x);
          if (r == null) continue;
          for (const c of [r.head, r.tail]) {
            expect(c.every((v) => Number.isFinite(v))).toBe(true);
            expect(c[0]).toBeGreaterThanOrEqual(0);
            expect(c[0]).toBeLessThanOrEqual(1);
            expect(c[2]).toBeGreaterThanOrEqual(0);
            expect(c[2]).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});
