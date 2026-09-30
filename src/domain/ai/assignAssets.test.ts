// 写真・動画を場面の差し込み口へソフトが割り当てる（ADR-0052 決定2・5・12 §8.8）。
import { describe, expect, it } from 'vitest';
import { ASSET_MATCH_MIN_SCORE } from '../constants';
import type { Asset } from '../project/types';
import type { Template } from '../template/types';
import { assignAssets, matchScore } from './assignAssets';
import type { AssignTarget } from './assignAssets';

function photo(id: string, words: Partial<Asset> = {}, assetType: Asset['assetType'] = 'image'): Asset {
  return { assetId: id, assetType, displayName: `${id}.jpg`, filePath: `assets/${id}.jpg`, ...words } as Asset;
}
function tmpl(slots: { id: string; slotType?: 'image' | 'video' | 'image_or_video' }[], extra: Template['layers'] = []): Template {
  return {
    templateId: 't', category: 'photo_intro', aspectRatio: '16:9',
    layers: [...slots.map((s) => ({ id: s.id, type: 'slot', x: 0, y: 0, w: 1, h: 1, slotType: s.slotType ?? 'image_or_video' })), ...extra],
  } as Template;
}
const target = (query: string[], template: Template | undefined = tmpl([{ id: 'mainVisual' }]), assetRefs: AssignTarget['assetRefs'] = {}): AssignTarget =>
  ({ template, assetRefs, query });

const office = photo('office', { aiDescription: '明るいオフィスで話す社員', tags: ['オフィス', '社員'] });
const warehouse = photo('warehouse', { aiDescription: '倉庫で荷物を運ぶ人', tags: ['倉庫', '作業'] });
const outside = photo('outside', { description: '本社の外観', tags: ['外観'] });

describe('matchScore', () => {
  it('素材の言葉のうち、見せたいものにもある2字の並びの割合（記号・空白・拡張子は見ない）', () => {
    expect(matchScore(['倉庫で荷物を運ぶ人の写真'], photo('x', { displayName: '倉庫.jpg' }))).toBe(1);
    expect(matchScore(['オフィス'], photo('y', { displayName: 'z', tags: ['外観'] }))).toBe(0);
    expect(matchScore(['なんでも'], photo('e', { displayName: '' }))).toBe(0);
  });

  it('名前・説明・AI解析・タグを別々に比べる（英数字のファイル名が説明の重なりを薄めない）', () => {
    const a = photo('a', { displayName: 'IMG_20260930_123456', aiDescription: '倉庫で荷物を運ぶ人' });
    expect(matchScore(['倉庫で荷物を運ぶ人の写真'], a)).toBe(1);
    expect(matchScore(['オフィス'], photo('t', { displayName: 'DSC0001', tags: ['会議', 'オフィス'] }))).toBe(1);
  });
});

describe('assignAssets', () => {
  it('見せたいものに合う素材を、空いている口へ当てる（合うものは自信あり）', () => {
    const out = assignAssets([target(['倉庫で働く人の写真']), target(['明るいオフィスの雰囲気'])], [office, warehouse]);
    expect(out.map((a) => [a.sceneIndex, a.assetId, a.lowConfidence])).toEqual([[0, 'warehouse', false], [1, 'office', false]]);
    expect(out.every((a) => a.score >= ASSET_MATCH_MIN_SCORE)).toBe(true);
  });

  it('同じ素材を重ねない（いちばん合う場面にだけ当て、ほかの場面には残りを当てる）', () => {
    const out = assignAssets([target(['オフィスの社員']), target(['オフィスの社員たち'])], [office, outside]);
    expect(new Set(out.map((a) => a.assetId)).size).toBe(2);
  });

  it('合うものが無くても、空いている口が残っていれば当てる（なるべく全部使う）＝自信が低い印', () => {
    const out = assignAssets([target(['歴史をふり返る'])], [outside]);
    expect(out).toEqual([{ sceneIndex: 0, slotId: 'mainVisual', assetId: 'outside', score: 0, lowConfidence: true }]);
  });

  it('AI が当てた素材は動かさず、ほかの場面にも使わない', () => {
    const out = assignAssets([target(['倉庫'], undefined, { mainVisual: 'warehouse' }), target(['倉庫'])], [warehouse, office]);
    expect(out).toEqual([expect.objectContaining({ sceneIndex: 1, assetId: 'office' })]);
  });

  it('見た目に無い鍵に残った素材は使用中と数えず、ほかの口に当てる（向きの補正で見た目が替わった等）', () => {
    const out = assignAssets([target(['倉庫'], undefined, { oldKey: 'warehouse' })], [warehouse]);
    expect(out).toEqual([expect.objectContaining({ sceneIndex: 0, slotId: 'mainVisual', assetId: 'warehouse' })]);
  });

  it('AI が明示的に空（null）にした口も空いている口として埋める', () => {
    expect(assignAssets([target(['倉庫'], undefined, { mainVisual: null })], [warehouse])).toHaveLength(1);
  });

  it('差し込み口の無い場面・見た目が分からない場面には当てない', () => {
    const noSlot = tmpl([], [{ id: 'bg', type: 'background', x: 0, y: 0, w: 1, h: 1 } as Template['layers'][number]]);
    expect(assignAssets([target(['倉庫'], noSlot), target(['倉庫'], null as unknown as undefined)], [warehouse])).toEqual([]);
  });

  it('口の種類に合う素材だけ（写真だけの口に動画を入れない）', () => {
    const clip = photo('clip', { tags: ['倉庫'] }, 'video');
    const out = assignAssets([target(['倉庫'], tmpl([{ id: 'p', slotType: 'image' }]))], [clip, office]);
    expect(out.map((a) => a.assetId)).toEqual(['office']);
  });

  it('ゆうこ・ロゴ・BGM は当てない', () => {
    const others = [photo('y', { tags: ['倉庫'] }, 'yuko'), photo('l', {}, 'logo'), photo('b', {}, 'bgm')];
    expect(assignAssets([target(['倉庫'])], others)).toEqual([]);
  });

  it('素材より口が多ければ、合う順に埋めて残りの口は空のまま', () => {
    const out = assignAssets([target(['会社の歴史']), target(['倉庫の作業']), target(['会議'])], [warehouse]);
    expect(out).toEqual([expect.objectContaining({ sceneIndex: 1, assetId: 'warehouse', lowConfidence: false })]);
  });

  it('しきい値ちょうどは自信あり（境目）', () => {
    // 素材の言葉「あいうえおか」の2字の並び 5 つのうち 1 つだけが見せたいものにある＝0.2。
    const a = photo('a', { displayName: 'あいうえおか' });
    const [r] = assignAssets([target(['あい'])], [a]);
    expect(r.score).toBeCloseTo(ASSET_MATCH_MIN_SCORE);
    expect(r.lowConfidence).toBe(false);
  });

  it('1つの場面の複数の口にも、合う順に別々の素材を当てる', () => {
    const two = tmpl([{ id: 'a' }, { id: 'b' }]);
    const out = assignAssets([target(['倉庫とオフィス'], two)], [warehouse, office]);
    expect(out.map((x) => x.slotId).sort()).toEqual(['a', 'b']);
    expect(new Set(out.map((x) => x.assetId)).size).toBe(2);
  });
});
