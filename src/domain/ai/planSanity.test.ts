// 同梱の AI の動画案が「使える形」か（#1403）。
import { describe, expect, it } from 'vitest';
import { isHollowPlan, planRunawayLimits } from './planSanity';
import type { AiVideoPlan } from './types';

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
