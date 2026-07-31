// キーフレーム補間（④・ADR-0019）。純粋・決定論（§7 テスト対象）。preview/export が同一関数を共有＝フレーム単位パリティ。
// 各プロパティは独立に補間する（キーフレームは変えたいプロパティだけ持てる）。区間 [前KF, 当KF] のイージングは「当KF.easing」。
// 区間外は端でクランプ（最初のKF前＝最初の値／最後のKF後＝最後の値）。
// 補間するのは値そのもの。x/y/scale/rotation を「本来値からの相対」として要素に重ねるか（既定）、絶対で使うかは
// 適用側（layoutScene）が決める（④ の適用は相対＝CSS transform 相当・opacity のみ絶対）。
import { EASING } from '../enums';
import type { BezierEasing, EasingSpec } from '../enums';
import type { Keyframe } from './types';

/** timeSec の補間結果（設定されたプロパティのみ）。 */
export interface InterpolatedTransform {
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
  rotation?: number;
}

const PROPS = ['x', 'y', 'scale', 'opacity', 'rotation'] as const;
type AnimProp = (typeof PROPS)[number];

/**
 * イージング（進捗 0..1 → 0..1）。名前つき（`EASINGS`）と**自由なカーブ**（#262・制御点4つ）の両方を受ける。
 * `ease-in-out` は既存の式のまま＝**既に作った動画の動きを変えない**（自由なカーブでは表せない形なので、
 * カーブへ移すときは画面が「動きが少し変わる」と断る＝ADR-0026④）。
 */
export function applyEasing(t: number, easing: EasingSpec | undefined): number {
  if (easing == null) return t; // linear
  if (typeof easing !== 'string') return bezierEasing(easing.bezier, t);
  switch (easing) {
    case EASING.easeInOut:
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    case EASING.easeIn:
    case EASING.easeOut:
      // 名前つきのうち、CSS と同じ定義で**制御点にそのまま置き換えられる**もの（`easingCurveOf`）。
      return bezierEasing(easingCurveOf(easing) as BezierEasing['bezier'], t);
    case EASING.linear:
      return t;
    default: {
      // 値が増えたらここがコンパイルエラーになる＝黙って linear に落とさない（§2-7）。
      const exhaustive: never = easing;
      return exhaustive;
    }
  }
}

/**
 * 名前つきイージングの**制御点による等価な表し方**（#262）。「自由なカーブにする」で使う。
 * `ease-in-out` は3次ベジェでは**正確に表せない**ので `null`＝**近い値で黙って置き換えない**（ADR-0026④）。
 */
export function easingCurveOf(easing: EasingSpec | undefined): BezierEasing['bezier'] | null {
  if (easing == null || easing === EASING.linear) return [0, 0, 1, 1];
  if (typeof easing !== 'string') return easing.bezier;
  if (easing === EASING.easeIn) return [0.42, 0, 1, 1];
  if (easing === EASING.easeOut) return [0, 0, 0.58, 1];
  return null;
}

/**
 * 3次ベジェのイージング（CSS の `cubic-bezier` と同じ）。進捗 `x` に対する `y` を返す。
 * `x` から媒介変数 `t` をニュートン法で求め、収束しなければ二分法へ落とす＝**同じ入力なら必ず同じ値**
 * （プレビューと書き出しが同じ関数を通る＝フレーム単位のパリティ・ADR-0019）。
 */
function bezierEasing(p: BezierEasing['bezier'], x: number): number {
  const [x1, y1, x2, y2] = p;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // 制御点が対角線上（＝linear）なら計算するまでもない。
  if (x1 === y1 && x2 === y2) return x;
  const curve = (a: number, b: number, t: number): number => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  const slope = (a: number, b: number, t: number): number => {
    const u = 1 - t;
    return 3 * u * u * (a) + 6 * u * t * (b - a) + 3 * t * t * (1 - b);
  };
  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const dx = curve(x1, x2, t) - x;
    if (Math.abs(dx) < 1e-7) return curve(y1, y2, t);
    const d = slope(x1, x2, t);
    if (Math.abs(d) < 1e-7) break;
    t -= dx / d;
  }
  // ニュートン法が効かない形（制御点が端に寄っている等）でも必ず答えを返す。
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 30; i += 1) {
    const cx = curve(x1, x2, t);
    if (Math.abs(cx - x) < 1e-7) break;
    if (cx > x) hi = t;
    else lo = t;
    t = (lo + hi) / 2;
  }
  return curve(y1, y2, t);
}

/**
 * キーフレーム列（timeSec 昇順想定）を timeSec で補間する。プロパティごとに、そのプロパティを持つKFだけで補間する。
 * 空／該当プロパティ無しは undefined（＝アニメ対象外＝基準値のまま）。
 */
export function interpolateKeyframes(keyframes: readonly Keyframe[], timeSec: number): InterpolatedTransform {
  const out: InterpolatedTransform = {};
  if (keyframes.length === 0) return out;
  for (const prop of PROPS) {
    // 該当プロパティを持つKFを timeSec 昇順に（手編集/将来オーサリングで順序が崩れても補間が狂わないよう防御的にソート）。
    const kfs = keyframes.filter((k) => k[prop] != null).sort((a, b) => a.timeSec - b.timeSec);
    if (kfs.length === 0) continue;
    if (timeSec <= kfs[0].timeSec) {
      out[prop] = kfs[0][prop];
      continue;
    }
    if (timeSec >= kfs[kfs.length - 1].timeSec) {
      out[prop] = kfs[kfs.length - 1][prop];
      continue;
    }
    for (let i = 1; i < kfs.length; i += 1) {
      if (timeSec < kfs[i].timeSec) {
        const a = kfs[i - 1];
        const b = kfs[i];
        const span = b.timeSec - a.timeSec;
        const raw = span > 0 ? (timeSec - a.timeSec) / span : 0;
        const e = applyEasing(raw, b.easing); // b へ入るイージング
        const av = a[prop] as number;
        const bv = b[prop] as number;
        out[prop] = av + (bv - av) * e;
        break;
      }
    }
  }
  return out;
}

/** 型補助：AnimProp を明示（PROPS の要素）。 */
export type { AnimProp };
