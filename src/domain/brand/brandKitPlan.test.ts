// 「何がいくつ変わるか」に**変わらないもの**も入れる（α-6 出口監査 🟡31・ADR-0036 決定3）。
//
// ⚠️ **場面ごとの指定は動画全体より優先される**（`11 §7.1.1`）＝その場面は反映しても見た目が変わらない。
// 数えずに「動画全体の文字の形が変わります」とだけ言うと、押したあとに自分で気づくしかない（§2-5）。
import { describe, expect, it } from 'vitest';
import { planBrandApply } from './brandKit';

describe('planBrandApply の keptScenes（🟡31）', () => {
  it('自分で文字の形を選んでいる場面を数える', () => {
    const plan = planBrandApply(
      { fontId: 'gen-interface-jp-display' },
      { fontId: 'gen-interface-jp', hasLogoAsset: true, sceneFontIds: ['user_font_001', null, undefined, 'gen-interface-jp'] },
    );
    expect(plan.fontChanges).toBe(true);
    expect(plan.keptScenes).toBe(2);
  });

  /** ⚠️ **変えないのに「そのままです」と言わない**＝数えるのは変えるときだけ。 */
  it('文字の形が変わらないなら数えない', () => {
    const plan = planBrandApply(
      { fontId: 'gen-interface-jp' },
      { fontId: 'gen-interface-jp', hasLogoAsset: true, sceneFontIds: ['user_font_001'] },
    );
    expect(plan.fontChanges).toBe(false);
    expect(plan.keptScenes).toBe(0);
  });
});
