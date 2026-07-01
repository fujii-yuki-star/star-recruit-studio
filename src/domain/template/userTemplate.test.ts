import { describe, expect, it } from 'vitest';
import type { Template } from './types';
import {
  buildBlankTemplate, createUserTemplateId, isUserTemplate, replaceUserTemplates, upsertUserTemplate, USER_TEMPLATE_PREFIX,
} from './userTemplate';
import { validateTemplate } from '../validation/generated/validators.js';

const tmpl = (templateId: string): Template => ({
  schemaVersion: '1.0', templateId, name: templateId, category: 'free', aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 }, layers: [{ id: 'bg', type: 'background', x: 0, y: 0, w: 1920, h: 1080 }],
});

describe('isUserTemplate', () => {
  it('user_tmpl_ 接頭辞のみユーザーテンプレ（同梱の記述的 id は false）', () => {
    expect(isUserTemplate('user_tmpl_001')).toBe(true);
    expect(isUserTemplate('opening_yuko_right_v1')).toBe(false);
    expect(isUserTemplate('free_canvas_v1')).toBe(false);
    expect(isUserTemplate(USER_TEMPLATE_PREFIX)).toBe(false); // 接頭辞のみ（_ なし）は対象外
  });
});

describe('createUserTemplateId', () => {
  it('空なら user_tmpl_001、既存があれば最大連番+1（同梱 id は無視）', () => {
    expect(createUserTemplateId([])).toBe('user_tmpl_001');
    expect(createUserTemplateId(['user_tmpl_001', 'opening_v1'])).toBe('user_tmpl_002');
  });

  it('空き番号は埋めない（max+1）＝削除した番号を再利用しない（ADR-0017）', () => {
    // 002 のみ残る（001 を削除した状況）でも 001 を再利用せず 003 を出す。
    expect(createUserTemplateId(['user_tmpl_002'])).toBe('user_tmpl_003');
    expect(createUserTemplateId(['user_tmpl_001', 'user_tmpl_003'])).toBe('user_tmpl_004');
  });

  it('採番した id はユーザーテンプレ判定を満たす', () => {
    const id = createUserTemplateId(['user_tmpl_001', 'user_tmpl_002']);
    expect(id).toBe('user_tmpl_003');
    expect(isUserTemplate(id)).toBe(true);
  });

  it('minSeq（払い出し済みの最大連番）を下回らない＝削除でファイルが消えても番号を戻さない', () => {
    // 現存は空でも、払い出し済み最大が 5 なら次は 006（削除した 001〜005 を再利用しない）。
    expect(createUserTemplateId([], 5)).toBe('user_tmpl_006');
    // 現存 max(003) より minSeq(5) が大きければ minSeq 優先。
    expect(createUserTemplateId(['user_tmpl_003'], 5)).toBe('user_tmpl_006');
    // 現存 max(007) が minSeq(5) より大きければ現存優先。
    expect(createUserTemplateId(['user_tmpl_007'], 5)).toBe('user_tmpl_008');
  });
});

describe('replaceUserTemplates', () => {
  it('ユーザーテンプレ部分だけ差し替え、同梱は保持（冪等）', () => {
    const base = [tmpl('opening_v1'), tmpl('user_tmpl_001')];
    const next = replaceUserTemplates(base, [tmpl('user_tmpl_002'), tmpl('user_tmpl_003')]);
    expect(next.map((t) => t.templateId)).toEqual(['opening_v1', 'user_tmpl_002', 'user_tmpl_003']);
    // 再実行しても重複しない（冪等）。
    expect(replaceUserTemplates(next, [tmpl('user_tmpl_002')]).map((t) => t.templateId)).toEqual(['opening_v1', 'user_tmpl_002']);
  });

  it('ユーザーテンプレが空なら同梱だけ残る（全削除/初回・user 部分が消える）', () => {
    const base = [tmpl('opening_v1'), tmpl('photo_v1'), tmpl('user_tmpl_001')];
    expect(replaceUserTemplates(base, []).map((t) => t.templateId)).toEqual(['opening_v1', 'photo_v1']);
  });

  it('既存にユーザーテンプレが無い初回読込でも同梱＋user が揃う', () => {
    const bundledOnly = [tmpl('opening_v1'), tmpl('photo_v1')];
    expect(replaceUserTemplates(bundledOnly, [tmpl('user_tmpl_001')]).map((t) => t.templateId)).toEqual(['opening_v1', 'photo_v1', 'user_tmpl_001']);
  });
});

describe('upsertUserTemplate', () => {
  it('id 一致は置換、無ければ末尾に追加', () => {
    const base = [tmpl('opening_v1'), tmpl('user_tmpl_001')];
    const added = upsertUserTemplate(base, tmpl('user_tmpl_002'));
    expect(added.map((t) => t.templateId)).toEqual(['opening_v1', 'user_tmpl_001', 'user_tmpl_002']);
    const replaced = upsertUserTemplate(base, { ...tmpl('user_tmpl_001'), name: '更新後' });
    expect(replaced).toHaveLength(2);
    expect(replaced.find((t) => t.templateId === 'user_tmpl_001')?.name).toBe('更新後');
  });
});

describe('buildBlankTemplate', () => {
  it('横型(16:9)は 1920×1080・背景1枚（全面）・指定メタを持ち schema 有効', () => {
    const t = buildBlankTemplate('user_tmpl_001', '新しい見た目', 'opening', '16:9');
    expect(t).toMatchObject({ templateId: 'user_tmpl_001', name: '新しい見た目', category: 'opening', aspectRatio: '16:9', schemaVersion: '1.0' });
    expect(t.canvas).toEqual({ width: 1920, height: 1080 });
    expect(t.layers).toHaveLength(1);
    expect(t.layers[0]).toMatchObject({ id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 });
    expect(validateTemplate(t)).toBe(true); // 保存→読込（loadUserTemplates）の ajv ゲートを通る＝消えない
  });

  it('縦型(9:16)は 1080×1920・背景も縦キャンバス全面', () => {
    const t = buildBlankTemplate('user_tmpl_002', 'タテ', 'free', '9:16');
    expect(t.canvas).toEqual({ width: 1080, height: 1920 });
    expect(t.layers[0]).toMatchObject({ w: 1080, h: 1920 });
    expect(validateTemplate(t)).toBe(true);
  });

  it('採番した id を渡せばユーザーテンプレ判定を満たす', () => {
    const id = createUserTemplateId(['user_tmpl_004']);
    expect(isUserTemplate(buildBlankTemplate(id, 'x', 'message', '16:9').templateId)).toBe(true);
  });
});
