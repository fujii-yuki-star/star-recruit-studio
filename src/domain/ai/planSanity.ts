// 同梱の AI の動画案が「使える形」かを見る（#1403）。純粋関数。
//
// ⚠️ **正典の検証（schema）とは別**＝schema に合っていても中身が空の案がありうる（実機で「セリフが空の3場面」が
//   「動画案ができました」として出た）。ここは「利用者に渡してよいか」を見る。
import { AI_PLAN_PART_SEC, AI_PLAN_PART_SLACK, AI_PLAN_RUNAWAY_DURATION_FACTOR, AI_PLAN_SCENES_PER_PART_MAX, AI_SCENE_MIN_DURATION_SEC, MAX_SCENES_PER_VIDEO } from '../constants';
import type { AiVideoPlan } from './types';

/** 書いている途中で止める上限（Rust の `GenerateLimits`）。尺から決める。 */
export interface PlanRunawayLimits {
  maxScenes: number;
  maxTotalSec: number;
}

/**
 * 尺から上限を決める（#1403）。
 * - 場面の数＝**尺を場面の最短の長さで割った数**（それより多いと、最短でも尺を越える）。動画の場面の上限も越えない。
 * - 長さの合計＝尺の `AI_PLAN_RUNAWAY_DURATION_FACTOR` 倍。
 */
export function planRunawayLimits(targetDurationSec: number): PlanRunawayLimits {
  return {
    maxScenes: Math.min(MAX_SCENES_PER_VIDEO, Math.max(1, Math.ceil(targetDurationSec / AI_SCENE_MIN_DURATION_SEC))),
    maxTotalSec: targetDurationSec * AI_PLAN_RUNAWAY_DURATION_FACTOR,
  };
}

/** その場面に話す文があるか（単独の読み上げ文か、掛け合いの行のどれか）。 */
function hasWords(scene: AiVideoPlan['parts'][number]['scenes'][number]): boolean {
  if ((scene.narrationText ?? '').trim()) return true;
  return (scene.narrationLines ?? []).some((l) => l.text.trim() !== '');
}

/**
 * **中身が足りない案**か（#1403）＝場面が無い、または**半分を越える場面に話す文が無い**。
 * 「動画案ができました」と出して、利用者に空の表を直させない（作り直す・断る）。
 */
export function isHollowPlan(plan: AiVideoPlan): boolean {
  const scenes = plan.parts.flatMap((p) => p.scenes);
  if (scenes.length === 0) return true;
  const silent = scenes.filter((s) => !hasWords(s)).length;
  return silent * 2 > scenes.length;
}

/** 書かせるときのパートの数の上限（#1415）。尺から決める（余裕の分で少なくとも 2）・動画の場面の上限を越えない。 */
export function planPartCap(targetDurationSec: number): number {
  return Math.min(MAX_SCENES_PER_VIDEO, Math.ceil(targetDurationSec / AI_PLAN_PART_SEC) + AI_PLAN_PART_SLACK);
}

/**
 * 同梱の AI に**書かせるとき**の縛りの形（#1415）＝正典の schema の写しに、パートと場面の数の上限（`maxItems`）を足す。
 * 上限に達すると AI は配列を閉じるしかない＝「1場面ずつのパートを増やし続けて止まらない」を形で止める。
 * ⚠️ **正典は変えない**（ADR-0051）＝返ってきた案は元の schema で検証する。上限は今より**狭くするだけ**。
 */
export function generationSchemaFor<T>(schema: T, targetDurationSec: number): T {
  const copy = structuredClone(schema) as unknown as {
    properties: { parts: { maxItems?: number; items: { properties: { scenes: { maxItems?: number } } } } };
  };
  copy.properties.parts.maxItems = planPartCap(targetDurationSec);
  copy.properties.parts.items.properties.scenes.maxItems = AI_PLAN_SCENES_PER_PART_MAX;
  return copy as unknown as T;
}
