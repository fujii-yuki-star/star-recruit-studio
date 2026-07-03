// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { allocateUserTemplateId, bumpUserTemplateMaxSeq, getUserTemplateMaxSeq, resolveUserTemplatesLoad } from './userTemplateFs';
import { buildBlankTemplate } from '../domain/template/userTemplate';

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

// complete は孤立素材の掃除(#299)の安全条件＝「削除」という不可逆操作を左右するため、欠け要因ごとに検証する。
describe('resolveUserTemplatesLoad（掃除#299 の安全条件 complete）', () => {
  const validJson = () => JSON.stringify(buildBlankTemplate('user_tmpl_001', 'テンプレ', 'opening', '16:9'));

  it('全ファイル健全・スキップ0・却下0 → complete=true（在庫が信頼できる＝掃除してよい）', () => {
    const r = resolveUserTemplatesLoad({ jsons: [validJson()], skipped: 0 });
    expect(r.complete).toBe(true);
    expect(r.templates).toHaveLength(1);
  });

  it('Rust がファイルをスキップ（skipped>0）→ 有効テンプレが揃っていても complete=false', () => {
    // 本PRの核心：read_to_string 一時失敗を「ファイルが無い」と誤認して掃除しないためのガード。
    const r = resolveUserTemplatesLoad({ jsons: [validJson()], skipped: 1 });
    expect(r.complete).toBe(false);
    expect(r.templates).toHaveLength(1); // 読めた分は活かす（一覧は出す）
  });

  it('壊れた JSON が混じる → complete=false（健全分は取り込むが掃除はしない）', () => {
    const r = resolveUserTemplatesLoad({ jsons: [validJson(), '{ broken'], skipped: 0 });
    expect(r.complete).toBe(false);
    expect(r.templates).toHaveLength(1);
  });

  it('スキーマ検証で却下される不正テンプレがある → complete=false', () => {
    const r = resolveUserTemplatesLoad({ jsons: [JSON.stringify({ templateId: 'user_tmpl_001' })], skipped: 0 });
    expect(r.complete).toBe(false);
    expect(r.templates).toHaveLength(0);
  });

  it('テンプレ0件・スキップ0 → complete=true（本当に空＝孤立を全掃除してよいケース）', () => {
    const r = resolveUserTemplatesLoad({ jsons: [], skipped: 0 });
    expect(r.complete).toBe(true);
    expect(r.templates).toHaveLength(0);
  });
});
