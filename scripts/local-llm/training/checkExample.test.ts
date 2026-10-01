// 学習材料の機械の確認（ADR-0052 段階4）。試作の 5 件は通り、壊した案は止まる。
import { describe, expect, it } from 'vitest';
import { checkExample } from './checkExample';
import { PILOT_EXAMPLES } from './pilotExamples';
import type { TrainingExample } from './pilotExamples';

const clone = (ex: TrainingExample): TrainingExample => structuredClone(ex);
const first = (ex: TrainingExample) => ex.plan.parts[0].scenes[0];

describe('checkExample', () => {
  it('試作の5件は問題なし', () => {
    for (const ex of PILOT_EXAMPLES) expect(checkExample(ex), ex.id).toEqual([]);
  });

  it('無い見た目・種類と見た目の食い違い・無い素材・無い表情を止める', () => {
    const a = clone(PILOT_EXAMPLES[0]); first(a).templateId = 'nope';
    expect(checkExample(a).join()).toContain('見せられない見た目');
    const b = clone(PILOT_EXAMPLES[0]); first(b).templateId = 'closing_yuko_v1';
    expect(checkExample(b).join()).toContain('種類と見た目が合わない');
    const c = clone(PILOT_EXAMPLES[0]); first(c).assetRefs = { mainVisual: 'zzz' };
    expect(checkExample(c).join()).toContain('無い素材');
    const d = clone(PILOT_EXAMPLES[0]); first(d).yukoPoseTag = 'angry';
    expect(checkExample(d).join()).toContain('無い表情');
  });

  it('知らない印・会社名の書き写し・字数の越え・尺のずれ・形の崩れを止める', () => {
    const a = clone(PILOT_EXAMPLES[0]); first(a).narrationText = '{社名}です';
    expect(checkExample(a).join()).toContain('知らない印');
    const b = clone(PILOT_EXAMPLES[0]); first(b).narrationText = '株式会社ひだまりケアです';
    expect(checkExample(b).join()).toContain('会社名を書き写している');
    const c = clone(PILOT_EXAMPLES[0]); first(c).narrationText = 'あ'.repeat(121);
    expect(checkExample(c).join()).toContain('字数の上限越え');
    const d = clone(PILOT_EXAMPLES[0]); first(d).durationSec = 60;
    expect(checkExample(d).join()).toContain('尺が目標から離れている');
    const e = clone(PILOT_EXAMPLES[0]); (e.plan as unknown as { schemaVersion: string }).schemaVersion = '9';
    expect(checkExample(e).join()).toContain('形が正典に合わない');
  });
});
