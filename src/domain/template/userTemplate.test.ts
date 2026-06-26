import { describe, expect, it } from 'vitest';
import { createUserTemplateId, isUserTemplate, USER_TEMPLATE_PREFIX } from './userTemplate';

describe('isUserTemplate', () => {
  it('user_tmpl_ 接頭辞のみユーザーテンプレ（同梱の記述的 id は false）', () => {
    expect(isUserTemplate('user_tmpl_001')).toBe(true);
    expect(isUserTemplate('opening_yuko_right_v1')).toBe(false);
    expect(isUserTemplate('free_canvas_v1')).toBe(false);
    expect(isUserTemplate(USER_TEMPLATE_PREFIX)).toBe(false); // 接頭辞のみ（_ なし）は対象外
  });
});

describe('createUserTemplateId', () => {
  it('空なら user_tmpl_001、既存があれば空き番号を埋める（同梱 id は無視）', () => {
    expect(createUserTemplateId([])).toBe('user_tmpl_001');
    expect(createUserTemplateId(['user_tmpl_001', 'opening_v1'])).toBe('user_tmpl_002');
    expect(createUserTemplateId(['user_tmpl_002'])).toBe('user_tmpl_001'); // 空き(001)を埋める
  });

  it('採番した id はユーザーテンプレ判定を満たす', () => {
    const id = createUserTemplateId(['user_tmpl_001', 'user_tmpl_002']);
    expect(id).toBe('user_tmpl_003');
    expect(isUserTemplate(id)).toBe(true);
  });
});
