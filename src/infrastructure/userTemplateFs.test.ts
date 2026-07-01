// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { allocateUserTemplateId, bumpUserTemplateMaxSeq, getUserTemplateMaxSeq } from './userTemplateFs';

// no-reuse 採番カウンタ（localStorage・ADR-0017）。jsdom で localStorage を使う（ADR-0014）。
describe('ユーザーテンプレ採番カウンタ（no-reuse・#214）', () => {
  beforeEach(() => localStorage.clear());

  it('初期は 0、bump で前進し後退しない', () => {
    expect(getUserTemplateMaxSeq()).toBe(0);
    bumpUserTemplateMaxSeq(5);
    expect(getUserTemplateMaxSeq()).toBe(5);
    bumpUserTemplateMaxSeq(3); // 小さい値では後退しない
    expect(getUserTemplateMaxSeq()).toBe(5);
    bumpUserTemplateMaxSeq(8);
    expect(getUserTemplateMaxSeq()).toBe(8);
  });

  it('allocateUserTemplateId：採番と同時にカウンタを前進＝現存が空でも削除番号を再利用しない', () => {
    expect(allocateUserTemplateId([])).toBe('user_tmpl_001');
    expect(getUserTemplateMaxSeq()).toBe(1); // bump 済み
    expect(allocateUserTemplateId([])).toBe('user_tmpl_002'); // 現存空でも 002（001 を再利用しない）
    expect(getUserTemplateMaxSeq()).toBe(2);
  });

  it('allocate：現存 id の最大が払い出し済みより大きければそちらを優先', () => {
    bumpUserTemplateMaxSeq(2);
    expect(allocateUserTemplateId(['user_tmpl_005'])).toBe('user_tmpl_006'); // max(現存5, 払出2)+1
    expect(getUserTemplateMaxSeq()).toBe(6);
  });
});
