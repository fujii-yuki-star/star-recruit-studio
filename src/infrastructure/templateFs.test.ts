import { describe, expect, it } from 'vitest';
import { loadBundledTemplates, parseTemplateFiles, parseTemplatePack, templatesForOrientation } from './templateFs';
import { sampleTemplates } from './sampleData';
import { SCENE_CATEGORIES } from '../domain/enums';

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
    // ID 直書きに依存せず「同梱の全件が検証を通る」ことを件数一致で確認。
    expect(loadBundledTemplates()).toHaveLength(sampleTemplates.length);
  });

  it('横型と縦型で同じカテゴリ集合を収録する＝向き別のカテゴリ網羅が対称（#456）', () => {
    const all = loadBundledTemplates();
    const catsFor = (o: '16:9' | '9:16') =>
      [...new Set(templatesForOrientation(all, o).map((t) => t.category))].sort();
    // 縦型が持つ全カテゴリを横型も持つ（横型の在庫不足の解消）。集合として完全対称。
    expect(catsFor('16:9')).toEqual(catsFor('9:16'));
    // 両向きとも全カテゴリ（SCENE_CATEGORIES）を網羅している（AI生成・手動選択が向きで偏らない・#415/#456）。
    for (const o of ['16:9', '9:16'] as const) {
      const cats = new Set(templatesForOrientation(all, o).map((t) => t.category));
      for (const c of SCENE_CATEGORIES) expect(cats.has(c)).toBe(true);
    }
  });
});

describe('parseTemplateFiles', () => {
  it('空リストは空の結果を返す', async () => {
    const { templates, rejected } = await parseTemplateFiles([]);
    expect(templates).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });

  it('JSON として読めないファイルは rejected に集約する（ファイル名つき）', async () => {
    const bad = new File(['not json'], 'bad.json', { type: 'application/json' });
    const { templates, rejected } = await parseTemplateFiles([bad]);
    expect(templates).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.templateId).toBeNull();
    expect(rejected[0]?.errors.join(' ')).toContain('bad.json');
  });

  it('配列ファイルと単体ファイルを混在しても集約する', async () => {
    const arrFile = new File([JSON.stringify([validLandscape, validPortrait])], 'pack.json');
    const oneFile = new File([JSON.stringify({ ...validLandscape, templateId: 'solo_v1' })], 'one.json');
    const { templates } = await parseTemplateFiles([arrFile, oneFile]);
    expect(templates.map((t) => t.templateId).sort()).toEqual(['solo_v1', 'test_land_v1', 'test_port_v1']);
  });

  it('大きすぎるファイルは取り込まない', async () => {
    const huge = new File(['x'.repeat(1_000_001)], 'huge.json');
    const { templates, rejected } = await parseTemplateFiles([huge]);
    expect(templates).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });
});

describe('縦型（9:16）同梱テンプレの網羅（B3）', () => {
  const portrait = () => loadBundledTemplates().filter((t) => t.aspectRatio === '9:16');

  it('全カテゴリ（free 含む）に 9:16 の同梱テンプレがある', () => {
    const covered = new Set(portrait().map((t) => t.category));
    for (const cat of SCENE_CATEGORIES) {
      expect(covered.has(cat)).toBe(true);
    }
  });

  it('縦型テンプレのキャンバスは 1080×1920', () => {
    for (const t of portrait()) {
      expect(t.canvas).toEqual({ width: 1080, height: 1920 });
    }
  });
});
