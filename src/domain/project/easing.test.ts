import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import { EASING, EASINGS } from '../enums';
import { describeAnimation, presetKeyframes, PRESET_KINDS } from './animationPresets';
import type { EasingSpec } from '../enums';
import { applyEasing, easingCurveOf, interpolateKeyframes } from './keyframes';

const LINEAR_CURVE: EasingSpec = { bezier: [0, 0, 1, 1] };

describe('applyEasing（動き方・#262）', () => {
  it('端は必ず 0 と 1（どの動き方でも、始まりと終わりの絵は同じ）', () => {
    const all: (EasingSpec | undefined)[] = [
      undefined,
      EASING.linear,
      EASING.easeIn,
      EASING.easeOut,
      EASING.easeInOut,
      { bezier: [0.9, 0.1, 0.1, 0.9] },
      { bezier: [0.25, 1.6, 0.75, -0.6] },
    ];
    for (const e of all) {
      expect(applyEasing(0, e)).toBe(0);
      expect(applyEasing(1, e)).toBe(1);
    }
  });

  it('制御点が対角線のカーブは「一定」と同じ', () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(applyEasing(t, LINEAR_CURVE)).toBeCloseTo(t, 9);
    }
  });

  it('ゆっくり始まる＝前半は一定より遅れ、ゆっくり終わる＝前半は先行する', () => {
    expect(applyEasing(0.25, EASING.easeIn)).toBeLessThan(0.25);
    expect(applyEasing(0.25, EASING.easeOut)).toBeGreaterThan(0.25);
  });

  it('進み方は単調（時間が戻らない＝x は 0〜1 に収めてある）', () => {
    const e: EasingSpec = { bezier: [0.2, 0.9, 0.8, 0.1] };
    let prev = -Infinity;
    for (let i = 0; i <= 50; i += 1) {
      const v = applyEasing(i / 50, e);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('y は範囲外にできる＝行き過ぎて戻る動きを作れる', () => {
    const overshoot: EasingSpec = { bezier: [0.34, 1.56, 0.64, 1] };
    const peak = Math.max(...Array.from({ length: 99 }, (_, i) => applyEasing((i + 1) / 100, overshoot)));
    expect(peak).toBeGreaterThan(1);
  });

  it('同じ入力なら必ず同じ値（プレビューと書き出しが同じ絵になる＝ADR-0019）', () => {
    const e: EasingSpec = { bezier: [0.05, 0.7, 0.1, 1 ] };
    for (const t of [0.01, 0.33, 0.5, 0.87, 0.99]) {
      expect(applyEasing(t, e)).toBe(applyEasing(t, e));
    }
  });

  it('ニュートン法が効かない形（制御点が端に寄る）でも答えを返す', () => {
    for (const e of [{ bezier: [0, 0, 0, 0] }, { bezier: [1, 1, 1, 1] }, { bezier: [0, 1, 1, 0] }] as EasingSpec[]) {
      const v = applyEasing(0.5, e);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('easingCurveOf（名前つき→制御点・#262）', () => {
  it('一定・ゆっくり始まる・ゆっくり終わるは、制御点でそのまま表せる（動きが変わらない）', () => {
    for (const e of [EASING.linear, EASING.easeIn, EASING.easeOut] as const) {
      const curve = easingCurveOf(e);
      expect(curve).not.toBeNull();
      if (!curve) return;
      for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        expect(applyEasing(t, { bezier: curve })).toBeCloseTo(applyEasing(t, e), 6);
      }
    }
  });

  it('名前つきの制御点は CSS と同じ値（ブラウザや資料と動きが食い違わない）', () => {
    // CSS の ease-in = cubic-bezier(0.42, 0, 1, 1) / ease-out = cubic-bezier(0, 0, 0.58, 1)。
    expect(easingCurveOf(EASING.easeIn)).toEqual([0.42, 0, 1, 1]);
    expect(easingCurveOf(EASING.easeOut)).toEqual([0, 0, 0.58, 1]);
  });

  it('両端ゆっくりは制御点では表せない＝近い値で黙って置き換えない', () => {
    expect(easingCurveOf(EASING.easeInOut)).toBeNull();
  });

  it('未指定は「一定」として扱う', () => {
    expect(easingCurveOf(undefined)).toEqual([0, 0, 1, 1]);
  });

  it('すでにカーブならそのまま返す', () => {
    expect(easingCurveOf({ bezier: [0.1, 0.2, 0.3, 0.4] })).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
});

describe('補間への効き方（#262）', () => {
  it('区間 [前KF, 当KF] の動き方は「当KF」の指定を使う', () => {
    const kfs = [
      { timeSec: 0, x: 0 },
      { timeSec: 1, x: 100, easing: { bezier: [0.42, 0, 1, 1] } as EasingSpec },
    ];
    // ゆっくり始まる＝中間では一定（50）より手前。
    expect(interpolateKeyframes(kfs, 0.5).x).toBeLessThan(50);
  });
});

describe('カーブの解き方（#262）', () => {
  // 総当たりで t を求める参照実装＝実装の解き方（ニュートン法＋二分法）と**独立**に答えを出す。
  const reference = (p: [number, number, number, number], x: number): number => {
    const [x1, y1, x2, y2] = p;
    const at = (a: number, b: number, t: number): number => {
      const u = 1 - t;
      return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
    };
    let best = 0;
    let bestErr = Infinity;
    for (let i = 0; i <= 200000; i += 1) {
      const t = i / 200000;
      const err = Math.abs(at(x1, x2, t) - x);
      if (err < bestErr) {
        bestErr = err;
        best = t;
      }
    }
    return at(y1, y2, best);
  };

  it('ニュートン法が効かない形（始まりの傾きが 0）でも、総当たりと同じ答えになる', () => {
    // x1=x2=0 は x(t)=t³＝始点の傾きが 0 なので、ニュートン法では進めず二分法に落ちる。
    const p: [number, number, number, number] = [0, 0.5, 0, 1];
    for (const x of [0.05, 0.2, 0.5, 0.8, 0.95]) {
      expect(applyEasing(x, { bezier: p })).toBeCloseTo(reference(p, x), 4);
    }
  });

  it('ふつうの形でも総当たりと同じ答えになる', () => {
    const p: [number, number, number, number] = [0.65, 0.05, 0.36, 1];
    for (const x of [0.1, 0.37, 0.62, 0.91]) {
      expect(applyEasing(x, { bezier: p })).toBeCloseTo(reference(p, x), 4);
    }
  });
});

describe('プリセットと動き方（#262・#266）', () => {
  it('プリセットは渡された動き方をそのまま載せる＝自由なカーブも運べる（作り直しで潰れない）', () => {
    const curve: EasingSpec = { bezier: [0.34, 1.56, 0.64, 1] };
    for (const kind of PRESET_KINDS) {
      const kfs = presetKeyframes(kind, { durationSec: 0.6, easing: curve, direction: 'left' });
      // 動き方は区間 [前KF, 当KF] ＝終点のキーフレームに載る。
      expect(kfs[kfs.length - 1].easing).toEqual(curve);
    }
  });

  it('置いた動き方は読み返せる（画面が「カーブが入っている」と分かる）', () => {
    const curve: EasingSpec = { bezier: [0.1, 0.2, 0.3, 0.4] };
    const kfs = presetKeyframes('fade', { durationSec: 0.5, easing: curve, direction: 'left' });
    expect(describeAnimation(kfs).easing).toEqual(curve);
  });
});

describe('動き方の値が正典（schema）と揃っている（§2-7）', () => {
  it('EASINGS と schema の選択肢が一致する（片方だけ増えたら落ちる）', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../../../docs/yuko_recruit_docs/schemas/project.schema.json', import.meta.url), 'utf-8'),
    );
    const named = schema.$defs.Keyframe.properties.easing.oneOf.find((b: { enum?: string[] }) => b.enum)?.enum;
    expect(named).toEqual([...EASINGS]);
  });
});
