import { describe, expect, it } from 'vitest';
import { loadBundledTemplates, parseTemplatePack, templatesForOrientation } from './templateFs';

// 検証用の最小・正当なテンプレ（schema 必須項目のみ）。category/aspectRatio を差し替えて異常系を作る。
const validLandscape = {
  schemaVersion: '1.0',
  templateId: 'test_land_v1',
  name: 'テスト横',
  category: 'opening',
  aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 },
  layers: [{ id: 'bg', type: 'background', x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
};
const validPortrait = {
  schemaVersion: '1.0',
  templateId: 'test_port_v1',
  name: 'テスト縦',
  category: 'message',
  aspectRatio: '9:16',
  canvas: { width: 1080, height: 1920 },
  layers: [{ id: 'bg', type: 'background', x: 0, y: 0, w: 1080, h: 1920, zIndex: 0 }],
};

describe('parseTemplatePack', () => {
  it('正しいテンプレは採用し、不正は rejected に分離する', () => {
    const { templates, rejected } = parseTemplatePack([
      validLandscape,
      { ...validLandscape, templateId: 'no_name', name: '' }, // name 空（minLength 1 違反）
      { ...validLandscape, templateId: 'bad_cat', category: 'foo' }, // category enum 違反
      { ...validLandscape, templateId: 'bad_ratio', aspectRatio: '4:3' }, // aspectRatio enum 違反
    ]);
    expect(templates.map((t) => t.templateId)).toEqual(['test_land_v1']);
    expect(rejected).toHaveLength(3);
    const ids = rejected.map((r) => r.templateId);
    expect(ids).toContain('no_name');
    expect(ids).toContain('bad_cat');
    expect(ids).toContain('bad_ratio');
  });

  it('slot レイヤーは slotType 必須（無いと不採用）', () => {
    const { templates, rejected } = parseTemplatePack({
      ...validLandscape,
      templateId: 'slot_no_type',
      layers: [{ id: 'm', type: 'slot', x: 0, y: 0, w: 100, h: 100 }], // slotType 欠落
    });
    expect(templates).toHaveLength(0);
    expect(rejected.map((r) => r.templateId)).toContain('slot_no_type');
  });

  it('単体オブジェクトも配列も受け付ける', () => {
    expect(parseTemplatePack(validPortrait).templates).toHaveLength(1);
    expect(parseTemplatePack([validPortrait, validLandscape]).templates).toHaveLength(2);
  });
});

describe('templatesForOrientation', () => {
  it('向きが一致するテンプレだけ返す', () => {
    const all = parseTemplatePack([validLandscape, validPortrait]).templates;
    expect(templatesForOrientation(all, '16:9').map((t) => t.templateId)).toEqual(['test_land_v1']);
    expect(templatesForOrientation(all, '9:16').map((t) => t.templateId)).toEqual(['test_port_v1']);
  });
});

describe('loadBundledTemplates', () => {
  it('同梱の標準見た目パターンは全件が検証を通る', () => {
    const ids = loadBundledTemplates().map((t) => t.templateId);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(ids).toContain('opening_yuko_right_v1');
  });
});
