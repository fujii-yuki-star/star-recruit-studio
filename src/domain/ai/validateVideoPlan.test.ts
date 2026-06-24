import { describe, expect, it } from 'vitest';
import { SAMPLE_VIDEO_PLAN } from '../../infrastructure/aiProviders/sampleVideoPlan';
import {
  parseAndValidateVideoPlan,
  stripCodeFence,
  validateAiVideoPlan,
} from './validateVideoPlan';

/** 正典サンプルの独立コピー（テストで mutate するため）。 */
function clonePlan(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(SAMPLE_VIDEO_PLAN)) as Record<string, unknown>;
}

describe('validateAiVideoPlan', () => {
  it('正典サンプル（ai-video-plan.sample 相当）は適合する', () => {
    const result = validateAiVideoPlan(SAMPLE_VIDEO_PLAN);
    expect(result.valid).toBe(true);
    // 受信前正規化で正規化コピーが返る（参照は別だが、余計キーの無いサンプルは内容等価）。
    if (result.valid) expect(result.plan).toEqual(SAMPLE_VIDEO_PLAN);
  });

  it('必須欠落（parts 無し）は不適合＋エラー', () => {
    const plan = clonePlan();
    delete plan.parts;
    const result = validateAiVideoPlan(plan);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join(' ')).toContain('parts');
    }
  });

  it('enum 違反（purpose）は不適合', () => {
    const plan = clonePlan();
    (plan.videoPlan as Record<string, unknown>).purpose = 'not_a_purpose';
    expect(validateAiVideoPlan(plan).valid).toBe(false);
  });

  it('schemaVersion が 1.0 以外は不適合（const）', () => {
    const plan = clonePlan();
    plan.schemaVersion = '2.0';
    expect(validateAiVideoPlan(plan).valid).toBe(false);
  });

  it('未知プロパティは受信前正規化で除去され、検証を通る（余計キーで落とさない＝間欠失敗の無害化）', () => {
    // スキーマ自体の additionalProperties:false は validate-schemas.mjs で担保。ここは検証関数の挙動：
    // 余計キーは検証前に正規化で除去するので、内部へ渡る plan には残らない（型・値は不変）。
    const plan = clonePlan();
    plan.unexpectedField = true;
    const result = validateAiVideoPlan(plan);
    expect(result.valid).toBe(true);
    if (result.valid) expect('unexpectedField' in result.plan).toBe(false);
  });

  it('sceneType "free" は AI 出力スキーマに不適合（AI は FREE テンプレを選ばない＝11§3.2）', () => {
    const plan = clonePlan();
    const scenes = (plan.parts as Array<Record<string, unknown>>)[0]
      ?.scenes as Array<Record<string, unknown>>;
    scenes[0].sceneType = 'free';
    expect(validateAiVideoPlan(plan).valid).toBe(false);
  });

  it('オブジェクトでない入力は不適合', () => {
    expect(validateAiVideoPlan(null).valid).toBe(false);
    expect(validateAiVideoPlan('文字列').valid).toBe(false);
    expect(validateAiVideoPlan(42).valid).toBe(false);
  });
});

describe('stripCodeFence', () => {
  it('フェンス無しはトリムのみ', () => {
    expect(stripCodeFence('  {"a":1}  ')).toBe('{"a":1}');
  });

  it('```json フェンスを剥がす', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('言語名なしの ``` フェンスも剥がす', () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
});

describe('parseAndValidateVideoPlan', () => {
  it('正典サンプルの JSON 文字列は適合する', () => {
    const result = parseAndValidateVideoPlan(JSON.stringify(SAMPLE_VIDEO_PLAN));
    expect(result.valid).toBe(true);
  });

  it('コードフェンス付き JSON でも適合する（保険的除去）', () => {
    const raw = '```json\n' + JSON.stringify(SAMPLE_VIDEO_PLAN) + '\n```';
    expect(parseAndValidateVideoPlan(raw).valid).toBe(true);
  });

  it('空応答は不適合（次の行動へ）', () => {
    const result = parseAndValidateVideoPlan('   ');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(' ')).toContain('空');
  });

  it('JSON でない応答は不適合', () => {
    const result = parseAndValidateVideoPlan('こんにちは、構成案です');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(' ')).toContain('JSON');
  });

  it('JSON だがスキーマ不適合は不適合', () => {
    expect(parseAndValidateVideoPlan('{}').valid).toBe(false);
  });
});
