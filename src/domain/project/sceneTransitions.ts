// 場面間トランジション（ADR-0009）の解決と xfade タイムライン計算。純粋関数（§7 テスト対象）。
// 描画/書き出しの実適用は T2（renderer/export + Rust filtergraph）。本モジュールは型安全な値解決と
// offset/実効尺の算出だけを担い、副作用を持たない。
import { TRANSITION_DEFAULT_SEC } from '../constants';
import { TRANSITION_DIRECTION, TRANSITION_TYPE } from '../enums';
import type { TransitionDirection, TransitionType } from '../enums';
import type { Scene, Transition } from './types';

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

/**
 * SceneEdit の「画面の切り替え」select 値（`none`/`fade`/`slide:<direction>`）を transition から導く。
 * resolveTransition と同じ実効値に寄せる＝wipe/zoom は fade として表示し、書き出しの実効値と UI を一致させる。
 */
export function deriveTransitionSelectValue(transition: Transition | undefined): string {
  const r = resolveTransition(transition);
  return r.type === TRANSITION_TYPE.slide ? `slide:${r.direction}` : r.type;
}

export interface BoundaryTransition {
  type: TransitionType;
  direction: TransitionDirection;
  /** clamp 済みの実効 D（秒）。書き出しと同じく両隣の場面尺で clamp する。0＝遷移なし（プレビュー不要）。 */
  durationSec: number;
}

/**
 * A→B 境界（scenes[targetIndex] に入る遷移＝transition.in）の実効値を、**書き出しと同じ全場面 transitionTimeline**で
 * 解決する（#408 Part 2 のプレビュー用）。scenes は project.scenes と同じ再生順、targetIndex は当該場面の添字。
 * targetIndex<=0（先頭＝切り替え元なし）／type=none／希望 D<=0 は durationSec=0（プレビューしない）を返す。
 * clamp は書き出し（buildExportScenes）と同一：対象境界までの全場面尺 sceneDurations と境界希望 boundaryDs
 * （none/先頭=0）から transitionTimeline を回し steps[targetIndex-1] を採る。左 clamp を累積結合尺 acc で行うため、
 * **直前場面が実効 D より短い（prev<D）場面でもプレビュー=書き出しが一致**する（2場面近似 min(D,prev,cur) だと
 * prev で過小になっていた＝#408 レビュー P1）。type/direction は resolveTransition と同一（wipe/zoom→fade）
 * ＝プレビュー=書き出し（ADR-0001/0026）。
 */
export function resolveBoundaryTransition(scenes: Scene[], targetIndex: number): BoundaryTransition {
  const scene = targetIndex >= 0 ? scenes[targetIndex] : undefined;
  const r = resolveTransition(scene?.transition);
  if (targetIndex <= 0 || !scene || r.type === TRANSITION_TYPE.none || r.durationSec <= 0) {
    return { type: r.type, direction: r.direction, durationSec: 0 };
  }
  // 書き出し（buildExportScenes）と同一の sceneDurations / boundaryDs を対象境界まで組む（none/先頭=0）。
  const upto = scenes.slice(0, targetIndex + 1);
  const sceneDurations = upto.map((s) => s.durationSec);
  const boundaryDs = upto.map((s, k) => {
    if (k === 0) return 0;
    const rr = resolveTransition(s.transition);
    return rr.type === TRANSITION_TYPE.none ? 0 : rr.durationSec;
  });
  const { steps } = transitionTimeline(sceneDurations, boundaryDs);
  return { type: r.type, direction: r.direction, durationSec: steps[targetIndex - 1]?.durationSec ?? 0 };
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
    // 左右どちらの尺も超えない。ADR-0009 は strict `<` だが、ここは `≤`（D=尺の極端値を許容）。
    // FFmpeg xfade は duration が入力尺以上だと未定義動作になりうるため、T2 で strict 化（min−ε 等）するか
    // 実測で許容を確認してから clamp を締める（境界計算自体は本関数に集約されている）。
    const d = Math.min(want, acc, sceneDurations[i]);
    steps.push({ offsetSec: acc - d, durationSec: d });
    acc = acc + sceneDurations[i] - d;
  }
  return { effectiveTotalSec: acc, steps };
}
