import { describe, expect, it } from 'vitest';
import type { Template } from './types';
import type { Scene } from '../project/types';
import type { Layer } from './types';
import { pickableTemplatesForScene, sceneCategoriesForOrientation, contentHiddenBySwitch, standardLookFixesForUnresolved, standardTemplateForScene } from './templateSelection';

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
  it('options は同じ場面カテゴリ＋同じ向きだけ（別カテゴリ・別向きは除外）・整合なら mismatchedCurrent 無し', () => {
    const r = pickableTemplatesForScene(all, 'opening', '16:9', openingLand);
    expect(r.options.map((t) => t.templateId)).toEqual(['opening_land', 'opening_land2']); // photo/縦は出ない
    expect(r.mismatchedCurrent).toBeUndefined();
  });

  it('向きが違えば同カテゴリでも options から除外（縦型プロジェクトは縦テンプレのみ）', () => {
    const r = pickableTemplatesForScene(all, 'opening', '9:16', openingPort);
    expect(r.options.map((t) => t.templateId)).toEqual(['opening_port']);
    expect(r.mismatchedCurrent).toBeUndefined();
  });

  it('不一致 current は options に混ぜず mismatchedCurrent として分ける（整合済みに見せない・#415 P2）', () => {
    // 横型プロジェクトの opening 場面に、旧データで縦テンプレ(openingPort)が当たっている状態。
    const r = pickableTemplatesForScene(all, 'opening', '16:9', openingPort);
    expect(r.options.map((t) => t.templateId)).toEqual(['opening_land', 'opening_land2']); // 有効な選択肢は一致分だけ
    expect(r.mismatchedCurrent?.templateId).toBe('opening_port'); // 不一致 current は別枠
  });

  it('現在のテンプレが既に一致集合にあれば mismatchedCurrent は無し（重複させない）', () => {
    const r = pickableTemplatesForScene(all, 'opening', '16:9', openingLand2);
    expect(r.options.map((t) => t.templateId)).toEqual(['opening_land', 'opening_land2']);
    expect(r.mismatchedCurrent).toBeUndefined();
  });

  it('current 無し（未解決）は options のみ・mismatchedCurrent 無し', () => {
    const r = pickableTemplatesForScene(all, 'photo_intro', '16:9', undefined);
    expect(r.options.map((t) => t.templateId)).toEqual(['photo_land']);
    expect(r.mismatchedCurrent).toBeUndefined();
  });
});

describe('pickableTemplatesForScene：FREE 全場面化（0.4.2 動確）', () => {
  const openLand = tpl({ templateId: 'open_land', category: 'opening', aspectRatio: '16:9' });
  const closeLand = tpl({ templateId: 'close_land', category: 'closing', aspectRatio: '16:9' });
  const freeLand = tpl({ templateId: 'free_land', category: 'free', aspectRatio: '16:9' });
  const freePort = tpl({ templateId: 'free_port', category: 'free', aspectRatio: '9:16' });
  const all = [openLand, closeLand, freeLand, freePort];

  it('通常場面（opening）でも FREE（同じ向き）が候補に出る＝全場面で自由配置を選べる', () => {
    const r = pickableTemplatesForScene(all, 'opening', '16:9', openLand);
    expect(r.options.map((t) => t.templateId).sort()).toEqual(['free_land', 'open_land']); // closing/縦は出ない
  });

  it('FREE 場面はどのカテゴリの見た目へも切替可＝FREE 化から戻れる（同じ向き）', () => {
    const r = pickableTemplatesForScene(all, 'free', '16:9', freeLand);
    expect(r.options.map((t) => t.templateId).sort()).toEqual(['close_land', 'free_land', 'open_land']);
    expect(r.mismatchedCurrent).toBeUndefined();
  });

  it('FREE の現行テンプレは通常場面でも「合っていない」にしない（同じ向きなら有効）', () => {
    const r = pickableTemplatesForScene(all, 'opening', '16:9', freeLand); // opening 場面が FREE を使用中
    expect(r.options.some((t) => t.templateId === 'free_land')).toBe(true);
    expect(r.mismatchedCurrent).toBeUndefined();
  });

  it('向き不一致の FREE は mismatchedCurrent（縦 FREE を横型場面で使用中）', () => {
    const r = pickableTemplatesForScene(all, 'opening', '16:9', freePort);
    expect(r.mismatchedCurrent?.templateId).toBe('free_port'); // 向きが違えば FREE でも不一致
    expect(r.options.some((t) => t.templateId === 'free_port')).toBe(false);
  });
});

describe('sceneCategoriesForOrientation（種類の選択肢・#528）', () => {
  // 先頭 describe の all（openingLand/photoLand/openingPort/openingLand2）を使う＝16:9 は opening/photo_intro、9:16 は opening。
  it('その向きで1つ以上見た目がある全カテゴリを SCENE_CATEGORIES 順で返す（別向きは除外）', () => {
    expect(sceneCategoriesForOrientation(all, '16:9')).toEqual(['opening', 'photo_intro']);
    expect(sceneCategoriesForOrientation(all, '9:16')).toEqual(['opening']); // openingPort のみ 9:16
  });
});

// #547：TEMPLATE_NOT_FOUND は**自動置換しない**（黙って中身が減った動画を出さない）。
// 代わりに「まとめて標準にする」を利用者の明示操作として出すので、その当て先と対象の判定を固定する。
describe('standardTemplateForScene / standardLookFixesForUnresolved（#547・標準へ寄せる明示操作）', () => {
  const userTmpl = tpl({ templateId: 'user_tmpl_001', category: 'opening', aspectRatio: '16:9' });
  const lay = (id: string, type: Layer['type']): Layer => ({ id, type, x: 0, y: 0, w: 10, h: 10 });
  const scn = (sceneId: string, sceneType: Scene['sceneType'], templateId: string, assetRefs: Record<string, string | null> = {}): Scene =>
    ({ sceneId, sceneType, templateId, partId: 'part_001', order: 1, durationSec: 8, assetRefs,
       character: { enabled: false, characterId: 'yuko' }, texts: {}, narration: { text: '', status: 'none' }, warnings: [] }) as Scene;
  // 差し込み先を持つ写真紹介（既定の fixture は layers: [] なので、外れる/残るの判定には層が要る）。
  const photoWithSlots = tpl({
    templateId: 'photo_land', category: 'photo_intro', aspectRatio: '16:9',
    layers: [lay('bg', 'background'), lay('mainVisual', 'slot'), lay('headline', 'text')],
  });
  const withSlots = [openingLand, photoWithSlots, openingPort, openingLand2];

  it('同じ向き・同じ種類の同梱テンプレの先頭を返す', () => {
    expect(standardTemplateForScene(all, 'opening', '16:9')?.templateId).toBe('opening_land');
    expect(standardTemplateForScene(all, 'photo_intro', '16:9')?.templateId).toBe('photo_land');
    expect(standardTemplateForScene(all, 'opening', '9:16')?.templateId).toBe('opening_port');
  });

  it('マイ見た目は当て先にしない（「見つからない」原因がマイ見た目の削除であることが多いため）', () => {
    // ユーザーテンプレを先頭に置いても、同梱テンプレが選ばれる。
    expect(standardTemplateForScene([userTmpl, ...all], 'opening', '16:9')?.templateId).toBe('opening_land');
    // 同梱が無ければ当て先なし＝手で選び直す（勝手にマイ見た目を当てない）。
    expect(standardTemplateForScene([userTmpl], 'opening', '16:9')).toBeUndefined();
  });

  it('その向き・種類に同梱テンプレが無ければ当て先なし', () => {
    expect(standardTemplateForScene(all, 'photo_intro', '9:16')).toBeUndefined(); // 縦の写真紹介は無い
  });

  it('解決できない場面だけを、当て先つきで返す（解決済みは触らない）', () => {
    const scenes = [
      scn('s1', 'opening', 'missing'),
      scn('s2', 'opening', 'opening_land'), // 解決済み
      scn('s3', 'photo_intro', 'gone'),
    ];
    const fixes = standardLookFixesForUnresolved(scenes, all, '16:9');
    expect(fixes.map((f) => [f.sceneId, f.template.templateId])).toEqual([
      ['s1', 'opening_land'],
      ['s3', 'photo_land'],
    ]);
  });

  it('当て先が無い場面は返さない（押しても何も起きないボタンを作らないための判定）', () => {
    expect(standardLookFixesForUnresolved([scn('s1', 'photo_intro', 'missing')], all, '9:16')).toEqual([]); // 縦の写真紹介は当て先なし
  });

  // マイ見た目は層 id が独自（layer_001…）なので、標準の差し込み先と一致せず写真が外れる。
  // 「3件直しました」だけ出すと中身が減ったことに気づけないまま書き出せるので、先に判定して示す（#547）。
  it('写真の割り当てが外れる場面は losesContent で分かる', () => {
    const keeps = standardLookFixesForUnresolved([scn('s1', 'photo_intro', 'gone', { mainVisual: 'asset_001' })], withSlots, '16:9');
    expect(keeps[0].losesContent).toBe(false); // 同じ差し込み先がある＝そのまま残る

    const loses = standardLookFixesForUnresolved([scn('s1', 'photo_intro', 'gone', { layer_001: 'asset_001' })], withSlots, '16:9');
    expect(loses[0].losesContent).toBe(true); // マイ見た目の層 id は標準に無い＝外れる
  });

  it('割り当てが空の差し込み先は「外れる」に数えない（失うものが無い）', () => {
    const fixes = standardLookFixesForUnresolved([scn('s1', 'photo_intro', 'gone', { layer_001: null })], withSlots, '16:9');
    expect(fixes[0].losesContent).toBe(false);
  });

  // FREE へ寄せる場合は通常配置を休眠保持する（ADR-0030 非破壊往復）＝自由配置が残っていれば中身は消えない。
  it('FREE へ寄せるとき、自由配置が残っていれば「出なくなる」とは言わない', () => {
    const freeTmpl = tpl({ templateId: 'free_std', category: 'free', aspectRatio: '16:9', layers: [lay('bg', 'background')] });
    const scene = { ...scn('s1', 'free', 'gone', { layer_001: 'asset_001' }), freeLayout: [{ id: 'free_001' }] } as unknown as Scene;
    const fixes = standardLookFixesForUnresolved([scene], [freeTmpl], '16:9');
    expect(fixes[0].template.templateId).toBe('free_std');
    expect(fixes[0].losesContent).toBe(false); // 休眠保持＝動画の中身は減らない
  });

  it('FREE へ寄せても自由配置が空なら、今出ている中身は消えると言う', () => {
    const freeTmpl = tpl({ templateId: 'free_std', category: 'free', aspectRatio: '16:9', layers: [lay('bg', 'background')] });
    const scene = scn('s1', 'free', 'gone', { layer_001: 'asset_001' }); // freeLayout 無し＝何も描かれない
    expect(standardLookFixesForUnresolved([scene], [freeTmpl], '16:9')[0].losesContent).toBe(true);
  });

  it('当て先に文字枠・立ち絵枠が無ければ、文字と立ち絵も「出なくなる」に数える', () => {
    const noTextTmpl = tpl({ templateId: 'plain', category: 'photo_intro', aspectRatio: '16:9', layers: [lay('mainVisual', 'slot')] });
    const scene = {
      ...scn('s1', 'photo_intro', 'gone', { mainVisual: 'a1' }),
      texts: { title: 'ごあいさつ', main: '   ' }, // 空白だけの文字は失うものに数えない
      character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_pose' },
    } as unknown as Scene;
    const hidden = contentHiddenBySwitch(scene, noTextTmpl);
    expect(hidden.slotIds).toEqual([]); // 差し込み先はある
    expect(hidden.textKeys).toEqual(['title']); // 文字枠が無い＝出ない
    expect(hidden.character).toBe(true); // 立ち絵枠が無い＝出ない
  });

  it('判定は switchSceneTemplate の清算規則と同じ差し込み先（背景・スロット・ロゴ）を見る', () => {
    const photo = photoWithSlots;
    const scene = scn('s1', 'photo_intro', 'gone', { mainVisual: 'a1', bg: 'a2', layer_009: 'a3' });
    expect(contentHiddenBySwitch(scene, photo).slotIds).toEqual(['layer_009']); // テンプレにある先は残り、無い先だけ外れる
  });
});
