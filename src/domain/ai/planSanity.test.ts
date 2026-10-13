// 同梱の AI の動画案が「使える形」か（#1403）。
import { describe, expect, it } from 'vitest';
import { generationSchemaFor, isCutShortPlan, isHollowPlan, planMinScenesPerPart, planPartCap, planRunawayLimits } from './planSanity';
import aiVideoPlanSchema from '../../../docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json';
import type { AiVideoPlan } from './types';
import { AI_PLAN_SCENES_PER_PART_MAX } from '../constants';

const plan = (narr: (string | null)[], lines?: string[]): AiVideoPlan => ({
  schemaVersion: '1.0',
  videoPlan: { title: 't', purpose: 'company_intro', targetDurationSec: 60 },
  parts: [{ partTitle: 'p', scenes: narr.map((n, i) => ({
    sceneType: 'opening', templateId: 't', durationSec: 10, texts: {}, narrationText: n,
    ...(i === 0 && lines ? { narrationLines: lines.map((text) => ({ text })) } : {}),
  })) }],
} as AiVideoPlan);

describe('planRunawayLimits', () => {
  it('場面の数は尺÷最短の長さ・長さの合計は尺の3倍', () => {
    expect(planRunawayLimits(60)).toEqual({ maxScenes: 20, maxTotalSec: 180 });
    expect(planRunawayLimits(10)).toEqual({ maxScenes: 4, maxTotalSec: 30 });
  });
  it('場面の数は動画の上限（80）を越えない・少なくとも1', () => {
    expect(planRunawayLimits(1800).maxScenes).toBe(80);
    expect(planRunawayLimits(0).maxScenes).toBe(1);
  });
});

describe('isHollowPlan', () => {
  it('半分を越える場面に話す文が無ければ中身が足りない', () => {
    expect(isHollowPlan(plan(['', '', 'あ']))).toBe(true);
    expect(isHollowPlan(plan([null, null, null]))).toBe(true);
    expect(isHollowPlan(plan(['あ', '', 'う']))).toBe(false);
    expect(isHollowPlan(plan(['あ', '']))).toBe(false); // ちょうど半分は通す
  });
  it('場面が無い案は中身が足りない', () => {
    expect(isHollowPlan(plan([]))).toBe(true);
  });
  it('掛け合いの行に文があれば話す文がある（空白だけの文は無い扱い）', () => {
    // 1場面目は読み上げが空でも掛け合いの行がある＝話す文が無いのは3場面のうち1つだけ（行を数えなければ2つで越える）。
    expect(isHollowPlan(plan(['', '', 'う'], ['こんにちは']))).toBe(false);
    expect(isHollowPlan(plan(['  ', ''], ['  ']))).toBe(true);
  });
});

describe('書かせるときの上限（#1415）', () => {
  it('パートの数は 尺÷12 秒＋2（尺が 0 でも 2・場面の上限を越えない）', () => {
    expect(planPartCap(60)).toBe(7);
    expect(planPartCap(30)).toBe(5);
    expect(planPartCap(0)).toBe(2);
    expect(planPartCap(100000)).toBe(80);
  });
  it('正典の写しに上限を足すだけで、正典そのものは変えない', () => {
    const before = JSON.stringify(aiVideoPlanSchema);
    const g = generationSchemaFor(aiVideoPlanSchema, 60) as typeof aiVideoPlanSchema & { properties: { parts: { maxItems: number } } };
    expect(g.properties.parts.maxItems).toBe(7);
    expect(JSON.stringify(aiVideoPlanSchema)).toBe(before);
  });
});

describe('章立てのある案で、1パートの場面の下限（#1421）', () => {
  it('尺を1場面の最長（15 秒）で割った数を、章の数で割り振る', () => {
    // 60 秒・3 章＝4 場面が要る → 1 章に 2 場面。
    expect(planMinScenesPerPart(60, 3)).toBe(2);
    // 30 秒・3 章＝2 場面 → 1 章に 1 場面（下限は付かない）。
    expect(planMinScenesPerPart(30, 3)).toBe(1);
    // 長い動画・章1つでも、パートの上限 × 下限が見張りを越えない（600 秒＝80 場面 ÷ 52 パート → 1）。
    expect(planMinScenesPerPart(600, 1)).toBe(1);
    // どの尺でも 1パートの場面の上限（4）より小さい。
    for (const t of [10, 30, 60, 120, 180, 300, 600]) expect(planMinScenesPerPart(t, 1)).toBeLessThan(AI_PLAN_SCENES_PER_PART_MAX);
    // 60 秒・章1つ＝4 場面が要るが、パートの上限（7）× 下限が書きすぎの見張り（20 場面）を越えないよう 2 に抑える。
    expect(planMinScenesPerPart(60, 1)).toBe(2);
    expect(planMinScenesPerPart(60, 1) * planPartCap(60)).toBeLessThanOrEqual(planRunawayLimits(60).maxScenes);
  });
  it('章立てが無ければ 1（採用・章を書かない一般）', () => {
    expect(planMinScenesPerPart(60, 0)).toBe(1);
  });
  it('縛りの形に下限を足す・正典の下限より狭くしない値は書かない', () => {
    type S = { properties: { parts: { items: { properties: { scenes: { minItems?: number } } } } } };
    const scenesOf = (x: unknown) => (x as S).properties.parts.items.properties.scenes;
    expect(scenesOf(generationSchemaFor(aiVideoPlanSchema, 60, { minScenesPerPart: 2 })).minItems).toBe(2);
    // 1 は正典（minItems 1）と同じ＝そのまま。0 を渡しても正典より広げない。
    expect(scenesOf(generationSchemaFor(aiVideoPlanSchema, 60, { minScenesPerPart: 1 })).minItems).toBe(1);
    expect(scenesOf(generationSchemaFor(aiVideoPlanSchema, 60, { minScenesPerPart: 0 })).minItems).toBe(1);
    expect(scenesOf(generationSchemaFor(aiVideoPlanSchema, 60)).minItems).toBe(1);
    // 正典そのものは変えない。
    expect(scenesOf(aiVideoPlanSchema).minItems).toBe(1);
  });
});

describe('上限で切られた案（#1421）', () => {
  const mk = (types: string[][]) =>
    ({ parts: types.map((t) => ({ partTitle: 'p', scenes: t.map((sceneType) => ({ sceneType, narrationText: 'あ' })) })) }) as unknown as Parameters<typeof isCutShortPlan>[0];
  const cap = planPartCap(60);
  it('パートが上限に達し、締めが無ければ切られた案', () => {
    expect(isCutShortPlan(mk(Array.from({ length: cap }, () => ['opening'])), 60, true)).toBe(true);
  });
  it('締めがあれば、上限に達していても切られていない', () => {
    expect(isCutShortPlan(mk([...Array.from({ length: cap - 1 }, () => ['opening']), ['closing']]), 60, true)).toBe(false);
  });
  it('上限より少なければ、締めが無くても切られていない（AI がそう書いた）', () => {
    expect(isCutShortPlan(mk(Array.from({ length: cap - 1 }, () => ['opening'])), 60, true)).toBe(false);
  });
  it('締めの見た目を選べないなら見ない', () => {
    expect(isCutShortPlan(mk(Array.from({ length: cap }, () => ['opening'])), 60, false)).toBe(false);
  });
});
