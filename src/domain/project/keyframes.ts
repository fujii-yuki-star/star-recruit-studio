// キーフレーム補間（④・ADR-0019）。純粋・決定論（§7 テスト対象）。preview/export が同一関数を共有＝フレーム単位パリティ。
// 各プロパティは独立に補間する（キーフレームは変えたいプロパティだけ持てる）。区間 [前KF, 当KF] のイージングは「当KF.easing」。
// 区間外は端でクランプ（最初のKF前＝最初の値／最後のKF後＝最後の値）。値は絶対上書き。
import { EASING } from '../enums';
import type { Easing } from '../enums';
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

/** イージング（進捗 0..1 → 0..1）。ease-in-out は緩急のある補間。 */
function applyEasing(t: number, easing: Easing | undefined): number {
  if (easing === EASING.easeInOut) return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  return t; // linear
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
