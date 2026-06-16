// 場面間トランジション（ADR-0009）の解決と xfade タイムライン計算。純粋関数（§7 テスト対象）。
// 描画/書き出しの実適用は T2（renderer/export + Rust filtergraph）。本モジュールは型安全な値解決と
// offset/実効尺の算出だけを担い、副作用を持たない。
import { TRANSITION_DEFAULT_SEC } from '../constants';
import { TRANSITION_DIRECTION, TRANSITION_TYPE } from '../enums';
import type { TransitionDirection, TransitionType } from '../enums';
import type { Transition } from './types';

export interface ResolvedTransition {
  /** none/fade/slide（MVP）。wipe/zoom は fade に丸める。 */
  type: TransitionType;
  /** slide のときのみ意味を持つ（ADR-0009：MVP は in に適用）。 */
  direction: TransitionDirection;
  /** 希望の遷移時間（秒・0 以上）。境界での上限 clamp は transitionTimeline が場面尺を見て行う。 */
  durationSec: number;
}

// MVP で実際に描画する種別。これ以外（wipe/zoom）は fade にフォールバックする。
const MVP_TYPES: readonly TransitionType[] = [
  TRANSITION_TYPE.none,
  TRANSITION_TYPE.fade,
  TRANSITION_TYPE.slide,
];

/**
 * 場面の「入り」トランジション（transition.in）を MVP の実効値へ解決する。
 * wipe/zoom は未対応のため fade に、direction 未指定は left に、durationSec は 0 以上に丸める。
 */
export function resolveTransition(transition: Transition | undefined): ResolvedTransition {
  const raw = transition?.in ?? TRANSITION_TYPE.none;
  const type = MVP_TYPES.includes(raw) ? raw : TRANSITION_TYPE.fade;
  return {
    type,
    direction: transition?.direction ?? TRANSITION_DIRECTION.left,
    durationSec: Math.max(0, transition?.durationSec ?? TRANSITION_DEFAULT_SEC),
  };
}

export interface TransitionStep {
  /** それまでの結合結果に対する xfade 開始位置（秒）。 */
  offsetSec: number;
  /** xfade の長さ（秒・clamp 済み）。0 は遷移なし（単純連結）。 */
  durationSec: number;
}

/**
 * 各場面の尺と「場面 i に入る遷移の希望 D」から、xfade の offset と実効総尺を求める。
 * - boundaryDs[i]（i≥1）＝場面 i が直前の結合結果へ重なる希望 D。boundaryDs[0] は無視（先頭は遷移なし）。
 * - D は左（それまでの結合結果）と右（場面 i）のどちらの尺も超えないよう clamp（極短場面対策）。
 * - 総尺 = Σ(durationSec) − Σ(適用 D)。
 */
export function transitionTimeline(
  sceneDurations: number[],
  boundaryDs: number[],
): { effectiveTotalSec: number; steps: TransitionStep[] } {
  const steps: TransitionStep[] = [];
  if (sceneDurations.length === 0) return { effectiveTotalSec: 0, steps };
  let acc = sceneDurations[0];
  for (let i = 1; i < sceneDurations.length; i += 1) {
    const want = Math.max(0, boundaryDs[i] ?? 0);
    const d = Math.min(want, acc, sceneDurations[i]); // 左右どちらの尺も超えない
    steps.push({ offsetSec: acc - d, durationSec: d });
    acc = acc + sceneDurations[i] - d;
  }
  return { effectiveTotalSec: acc, steps };
}
