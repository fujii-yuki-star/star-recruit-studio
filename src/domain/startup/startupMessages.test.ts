import { describe, expect, it } from 'vitest';
import { importDoneMessage, startupArgErrorMessage } from './startupMessages';

describe('起動のときの指定が読めなかったときの文（ADR-0042 ④）', () => {
  // ⚠️ **どれが悪いかを出す**＝直すのは頼んだ側（人か、その人の AI）。
  it('どの指定が悪いかを名指しする', () => {
    expect(startupArgErrorMessage({ kind: 'unknown', flag: '--exprot' })).toContain('--exprot');
    expect(startupArgErrorMessage({ kind: 'missingValue', flag: '--import' })).toContain('--import');
  });

  // ⚠️ **次の行動を言う**（§2-5）＝「失敗しました」で終わらせない。
  it('どれも「次に何をすればよいか」を言う', () => {
    const all = [
      startupArgErrorMessage({ kind: 'unknown', flag: '--x' }),
      startupArgErrorMessage({ kind: 'missingValue', flag: '--x' }),
      startupArgErrorMessage({ kind: 'incompleteExport', flag: null }),
      startupArgErrorMessage({ kind: 'conflicting', flag: null }),
    ];
    for (const m of all) {
      expect(m, m).toMatch(/ください/);
    }
  });

  // ⚠️ **技術語を出さない**（§2-3）。
  it('技術語を出さない', () => {
    const all = (['unknown', 'missingValue', 'incompleteExport', 'conflicting'] as const).map((k) =>
      startupArgErrorMessage({ kind: k, flag: '--import' }),
    );
    for (const m of all) {
      expect(m, m).not.toMatch(/引数|パース|オプション|フラグ|JSON|パス/);
    }
  });
});

describe('取り込めたときの知らせ', () => {
  it('落としたぶんがあれば言う（黙って減らさない）', () => {
    expect(importDoneMessage(3, 2)).toContain('2');
  });

  // ⚠️ **0 件は言わない**＝毎回言うと、本当に落ちた回が埋もれる。
  it('落としたぶんが無ければ言わない', () => {
    const m = importDoneMessage(3, 0);
    expect(m).toContain('3');
    expect(m).not.toMatch(/取り込めなかった/);
  });
});
