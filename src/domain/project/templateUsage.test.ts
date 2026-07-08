import { describe, expect, it } from 'vitest';
import { scenesUsingTemplate } from './templateUsage';
import type { Scene } from './types';

const base = (over: Partial<Scene>): Scene =>
  ({
    sceneId: 's', partId: 'p', order: 1, sceneType: 'photo_intro', templateId: 'tpl',
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
    texts: {}, narration: { text: '', status: 'none' }, warnings: [], ...over,
  } as unknown as Scene);

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
});
