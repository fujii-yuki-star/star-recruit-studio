import { describe, expect, it } from 'vitest';
import { scenesUsingTemplate, substituteDeletedTemplateInScenes } from './templateUsage';
import type { Scene } from './types';
import type { Template } from '../template/types';

const base = (over: Partial<Scene>): Scene =>
  ({
    sceneId: 's', partId: 'p', order: 1, sceneType: 'photo_intro', templateId: 'tpl',
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
    texts: {}, narration: { text: '', status: 'none' }, warnings: [], ...over,
  } as unknown as Scene);

const tpl = (over: Partial<Template>): Template =>
  ({ templateId: 't', name: 'n', category: 'photo_intro', aspectRatio: '16:9', canvas: { width: 1920, height: 1080 }, layers: [], ...over } as unknown as Template);

describe('templateUsage', () => {
  it('scenesUsingTemplate は templateId 一致の場面だけ返す（順序保持）', () => {
    const scenes = [
      base({ sceneId: 's1', order: 1, templateId: 'user_tmpl_001' }),
      base({ sceneId: 's2', order: 2, templateId: 'opening_a' }),
      base({ sceneId: 's3', order: 3, templateId: 'user_tmpl_001' }),
    ];
    expect(scenesUsingTemplate(scenes, 'user_tmpl_001').map((s) => s.sceneId)).toEqual(['s1', 's3']);
    expect(scenesUsingTemplate(scenes, 'opening_a').map((s) => s.sceneId)).toEqual(['s2']);
    expect(scenesUsingTemplate(scenes, 'no_such')).toEqual([]);
  });

  describe('substituteDeletedTemplateInScenes（削除時の標準置換・#458・§9）', () => {
    const templates = [
      tpl({ templateId: 'std_photo_16', category: 'photo_intro', aspectRatio: '16:9' }),
      tpl({ templateId: 'std_opening_16', category: 'opening', aspectRatio: '16:9' }),
      tpl({ templateId: 'std_photo_9', category: 'photo_intro', aspectRatio: '9:16' }),
    ];

    it('削除テンプレを参照する場面を同カテゴリ・同じ向きの標準へ置換する（非参照は不変）', () => {
      const scenes = [
        base({ sceneId: 's1', sceneType: 'photo_intro', templateId: 'user_tmpl_001' }),
        base({ sceneId: 's2', sceneType: 'opening', templateId: 'std_opening_16' }),
      ];
      const next = substituteDeletedTemplateInScenes(scenes, 'user_tmpl_001', templates, '16:9');
      expect(next[0].templateId).toBe('std_photo_16');
      expect(next[1].templateId).toBe('std_opening_16');
    });

    it('代替が無い（向き/カテゴリ不一致）場面は原状維持＝同一参照（§9 補正が描画時に対応）', () => {
      const scenes = [base({ sceneId: 's1', sceneType: 'photo_intro', templateId: 'user_tmpl_001' })];
      const onlyPortrait = [tpl({ templateId: 'std_photo_9', category: 'photo_intro', aspectRatio: '9:16' })];
      const next = substituteDeletedTemplateInScenes(scenes, 'user_tmpl_001', onlyPortrait, '16:9');
      expect(next[0].templateId).toBe('user_tmpl_001');
      expect(next).toBe(scenes);
    });

    it('参照している場面が無ければ同一参照を返す（未保存/再描画を無駄に起こさない）', () => {
      const scenes = [base({ sceneId: 's1', templateId: 'std_photo_16' })];
      expect(substituteDeletedTemplateInScenes(scenes, 'user_tmpl_001', templates, '16:9')).toBe(scenes);
    });

    it('置換時にテンプレ依存の assetRefs / slotFits / warnings を正準経路で清算する（switchSceneTemplate・11§5・#236）', () => {
      const scene = base({
        sceneId: 's1', sceneType: 'opening', templateId: 'user_tmpl_001',
        assetRefs: { oldSlot: 'asset_x' }, // 削除テンプレ固有のスロット参照（新テンプレに無い）
        slotFits: { oldSlot: 'cover' },
        warnings: [{ code: 'X', message: 'm', field: 'templateId', level: 'warning', autoFixed: false }],
      } as unknown as Partial<Scene>);
      const alt = tpl({
        templateId: 'std_opening_16', category: 'opening', aspectRatio: '16:9',
        layers: [{ id: 'newSlot', type: 'slot', x: 0, y: 0, w: 10, h: 10 }],
      } as unknown as Partial<Template>);
      const next = substituteDeletedTemplateInScenes([scene], 'user_tmpl_001', [alt], '16:9');
      expect(next[0].templateId).toBe('std_opening_16');
      expect(next[0].assetRefs).toEqual({}); // 旧スロット参照は清算（新テンプレのスロット id 集合に無い）
      expect(next[0].slotFits).toBeUndefined();
      expect(next[0].warnings).toEqual([]); // 旧テンプレ基準の検証結果はクリア（再検証前提）
    });

    it('置換先候補から削除テンプレ自身は除く（自身しか無ければ代替なし＝原状維持）', () => {
      const scenes = [base({ sceneId: 's1', sceneType: 'free', templateId: 'user_tmpl_001' })];
      const withDeleted = [tpl({ templateId: 'user_tmpl_001', category: 'free', aspectRatio: '16:9' })];
      expect(substituteDeletedTemplateInScenes(scenes, 'user_tmpl_001', withDeleted, '16:9')[0].templateId).toBe('user_tmpl_001');
    });
  });
});
