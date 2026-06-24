import { describe, expect, it } from 'vitest';
import validPlanFixture from '../../../docs/yuko_recruit_docs/fixtures/ai-video-plan.sample.json';
import { sanitizeAiVideoPlan } from './sanitizeVideoPlan';
import { validateAiVideoPlan } from './validateVideoPlan';

// 最小の有効な構成案（必須フィールドのみ）。未知キーを足して除去を検証する土台。
const minimalValid = {
  schemaVersion: '1.0',
  videoPlan: { title: 'T', purpose: 'company_intro', targetDurationSec: 60 },
  parts: [
    {
      partTitle: 'P1',
      scenes: [
        {
          sceneType: 'opening',
          templateId: 'opening_yuko_right_v1',
          durationSec: 5,
          texts: { title: 'タイトル' },
          narrationText: 'こんにちは',
        },
      ],
    },
  ],
};

describe('sanitizeAiVideoPlan：未知キー除去（スキーマ駆動・型/値は変えない）', () => {
  it('正常な構成案は構造を変えない（往復で等価）', () => {
    expect(sanitizeAiVideoPlan(validPlanFixture)).toEqual(validPlanFixture);
    expect(sanitizeAiVideoPlan(minimalValid)).toEqual(minimalValid);
  });

  it('各階層（トップ・videoPlan・part・scene・texts）の未知キーを除去する', () => {
    const dirty = {
      ...minimalValid,
      explanation: '余計な説明',
      videoPlan: { ...minimalValid.videoPlan, unknownA: 'a' },
      parts: [
        {
          ...minimalValid.parts[0],
          order: 3,
          scenes: [
            {
              ...minimalValid.parts[0].scenes[0],
              mood: 'happy',
              texts: { ...minimalValid.parts[0].scenes[0].texts, footer: 'f' },
            },
          ],
        },
      ],
    };
    const out = JSON.stringify(sanitizeAiVideoPlan(dirty));
    for (const unknownKey of ['explanation', 'unknownA', 'order', 'mood', 'footer']) {
      expect(out).not.toContain(unknownKey);
    }
    // 正規キーは保持。
    expect(out).toContain('templateId');
    expect(out).toContain('narrationText');
  });

  it('assetRefs の動的キー（slot→asset の対応）は保持する', () => {
    const dirty = {
      ...minimalValid,
      parts: [
        {
          ...minimalValid.parts[0],
          scenes: [
            {
              ...minimalValid.parts[0].scenes[0],
              assetRefs: { slot_main: 'asset_001', slot_sub: null },
            },
          ],
        },
      ],
    };
    const out = sanitizeAiVideoPlan(dirty) as { parts: { scenes: { assetRefs?: unknown }[] }[] };
    expect(out.parts[0].scenes[0].assetRefs).toEqual({ slot_main: 'asset_001', slot_sub: null });
  });

  it('余計キーだけが原因の不適合は、サニタイズ後に検証を通る（間欠失敗の無害化）', () => {
    const dirty = {
      ...minimalValid,
      explanation: 'これは余計な説明キー',
      parts: [
        { ...minimalValid.parts[0], scenes: [{ ...minimalValid.parts[0].scenes[0], mood: 'happy' }] },
      ],
    };
    expect(validateAiVideoPlan(dirty).valid).toBe(true);
  });

  it('必須欠落はサニタイズしても検証で捕捉される（型/値は変えない）', () => {
    expect(validateAiVideoPlan({ schemaVersion: '1.0' }).valid).toBe(false);
  });

  it('任意項目の null（texts.main/subtitle・assetRefs）は除去され検証を通る', () => {
    const dirty = {
      ...minimalValid,
      parts: [
        {
          ...minimalValid.parts[0],
          scenes: [
            {
              ...minimalValid.parts[0].scenes[0],
              texts: { ...minimalValid.parts[0].scenes[0].texts, main: null, subtitle: null },
              assetRefs: null,
            },
          ],
        },
      ],
    };
    expect(validateAiVideoPlan(dirty).valid).toBe(true);
  });

  it('assetRefs が空配列 [] でも除去して検証を通る', () => {
    const dirty = {
      ...minimalValid,
      parts: [
        {
          ...minimalValid.parts[0],
          scenes: [{ ...minimalValid.parts[0].scenes[0], assetRefs: [] }],
        },
      ],
    };
    expect(validateAiVideoPlan(dirty).valid).toBe(true);
  });

  it('narrationText:null は許容され検証を通る（自動リトライせず1回で通す。変換で空＝無音シーンに整える）', () => {
    const dirty = {
      ...minimalValid,
      parts: [
        {
          ...minimalValid.parts[0],
          scenes: [{ ...minimalValid.parts[0].scenes[0], narrationText: null }],
        },
      ],
    };
    expect(validateAiVideoPlan(dirty).valid).toBe(true);
  });

  it('null 可の項目（yukoPoseTag:null）は保持する', () => {
    const dirty = {
      ...minimalValid,
      parts: [
        {
          ...minimalValid.parts[0],
          scenes: [{ ...minimalValid.parts[0].scenes[0], yukoPoseTag: null }],
        },
      ],
    };
    const out = sanitizeAiVideoPlan(dirty) as { parts: { scenes: { yukoPoseTag?: unknown }[] }[] };
    expect('yukoPoseTag' in out.parts[0].scenes[0]).toBe(true);
    expect(out.parts[0].scenes[0].yukoPoseTag).toBeNull();
    expect(validateAiVideoPlan(dirty).valid).toBe(true);
  });
});
