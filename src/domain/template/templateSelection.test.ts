import { describe, expect, it } from 'vitest';
import type { Template } from './types';
import { pickableTemplatesForScene } from './templateSelection';

function tpl(over: Partial<Template> & Pick<Template, 'templateId' | 'category' | 'aspectRatio'>): Template {
  return {
    schemaVersion: '1.0', name: over.templateId, canvas: { width: 1920, height: 1080 }, layers: [],
    defaults: { backgroundColor: '#fff' }, ...over,
  } as Template;
}

const openingLand = tpl({ templateId: 'opening_land', category: 'opening', aspectRatio: '16:9' });
const photoLand = tpl({ templateId: 'photo_land', category: 'photo_intro', aspectRatio: '16:9' });
const openingPort = tpl({ templateId: 'opening_port', category: 'opening', aspectRatio: '9:16' });
const openingLand2 = tpl({ templateId: 'opening_land2', category: 'opening', aspectRatio: '16:9' });
const all = [openingLand, photoLand, openingPort, openingLand2];

describe('pickableTemplatesForScene（ADR-0012・#415）', () => {
  it('同じ場面カテゴリ＋同じ向きだけ返す（別カテゴリ・別向きは除外）', () => {
    const r = pickableTemplatesForScene(all, 'opening', '16:9', openingLand);
    expect(r.map((t) => t.templateId)).toEqual(['opening_land', 'opening_land2']); // photo/縦は出ない
  });

  it('向きが違えば同カテゴリでも除外（縦型プロジェクトは縦テンプレのみ）', () => {
    const r = pickableTemplatesForScene(all, 'opening', '9:16', openingPort);
    expect(r.map((t) => t.templateId)).toEqual(['opening_port']);
  });

  it('現在のテンプレが絞り込みに入らなくても必ず含める（不一致でも選択値を見せる）', () => {
    // 横型プロジェクトの opening 場面に、旧データで縦テンプレ(openingPort)が当たっている状態。
    const r = pickableTemplatesForScene(all, 'opening', '16:9', openingPort);
    expect(r.map((t) => t.templateId)).toEqual(['opening_port', 'opening_land', 'opening_land2']); // 先頭に現行
  });

  it('現在のテンプレが既に一致集合にあれば重複させない', () => {
    const r = pickableTemplatesForScene(all, 'opening', '16:9', openingLand2);
    expect(r.map((t) => t.templateId)).toEqual(['opening_land', 'opening_land2']);
  });

  it('current 無し（未解決）は一致集合のみ', () => {
    const r = pickableTemplatesForScene(all, 'photo_intro', '16:9', undefined);
    expect(r.map((t) => t.templateId)).toEqual(['photo_land']);
  });
});
