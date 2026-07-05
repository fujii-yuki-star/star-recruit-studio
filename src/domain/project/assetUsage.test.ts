import { describe, expect, it } from 'vitest';
import { scenesUsingAsset, sceneUsesAsset } from './assetUsage';
import type { Scene } from './types';

const base = (over: Partial<Scene>): Scene =>
  ({
    sceneId: 's', partId: 'p', order: 1, sceneType: 'photo_intro', templateId: 'tpl',
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
    texts: {}, narration: { text: '', status: 'none' }, warnings: [], ...over,
  } as unknown as Scene);

describe('assetUsage', () => {
  it('assetRefs のスロット割当を検出（null 値は無視）', () => {
    const s = base({ assetRefs: { mainVisual: 'asset_001', logo: null } as never });
    expect(sceneUsesAsset(s, 'asset_001')).toBe(true);
    expect(sceneUsesAsset(s, 'asset_999')).toBe(false);
  });

  it('character.poseAssetId を検出', () => {
    const s = base({ character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_pose' } as never });
    expect(sceneUsesAsset(s, 'asset_pose')).toBe(true);
  });

  it('FREE 要素の assetId を検出（ADR-0008）', () => {
    const s = base({ freeLayout: [{ id: 'el1', assetId: 'asset_free' }] as never });
    expect(sceneUsesAsset(s, 'asset_free')).toBe(true);
  });

  it('scenesUsingAsset は使用場面だけ返す（順序保持）', () => {
    const scenes = [
      base({ sceneId: 's1', assetRefs: { slot: 'A' } as never }),
      base({ sceneId: 's2', assetRefs: {} as never }),
      base({ sceneId: 's3', freeLayout: [{ id: 'e', assetId: 'A' }] as never }),
    ];
    expect(scenesUsingAsset(scenes, 'A').map((s) => s.sceneId)).toEqual(['s1', 's3']);
    expect(scenesUsingAsset(scenes, 'Z')).toEqual([]);
  });
});
