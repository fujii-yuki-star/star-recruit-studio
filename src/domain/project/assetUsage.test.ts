import { describe, expect, it } from 'vitest';
import { sceneActiveAssetIds, scenesUsingAsset, sceneUsesAsset } from './assetUsage';
import type { Scene } from './types';
import type { Template } from '../template/types';

const base = (over: Partial<Scene>): Scene =>
  ({
    sceneId: 's', partId: 'p', order: 1, sceneType: 'photo_intro', templateId: 'tpl',
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
    texts: {}, narration: { text: '', status: 'none' }, warnings: [], ...over,
  } as unknown as Scene);

// sceneActiveAssetIds は template.category しか見ない（ADR-0030）。最小 Template でゲートを確かめる。
const normalTmpl = { category: 'photo_intro' } as Template;
const freeTmpl = { category: 'free' } as Template;

describe('assetUsage（実効使用・ADR-0030）', () => {
  it('通常場面：assetRefs のスロット割当を検出（null 値は無視）', () => {
    const s = base({ assetRefs: { mainVisual: 'asset_001', logo: null } as never });
    expect(sceneUsesAsset(s, 'asset_001', normalTmpl)).toBe(true);
    expect(sceneUsesAsset(s, 'asset_999', normalTmpl)).toBe(false);
  });

  it('通常場面：character.poseAssetId を検出', () => {
    const s = base({ character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_pose' } as never });
    expect(sceneUsesAsset(s, 'asset_pose', normalTmpl)).toBe(true);
  });

  it('FREE 場面：freeLayout の assetId を検出（ADR-0008）', () => {
    const s = base({ templateId: 'free_v1', sceneType: 'free', freeLayout: [{ id: 'el1', assetId: 'asset_free' }] as never });
    expect(sceneUsesAsset(s, 'asset_free', freeTmpl)).toBe(true);
  });

  it('休眠は数えない：通常場面の freeLayout・FREE 場面の assetRefs/character（ADR-0030・#524 P2）', () => {
    // 通常場面に残った休眠 freeLayout の素材は使用扱いにしない（描画されない）。
    const normalDormant = base({ freeLayout: [{ id: 'e', assetId: 'asset_free' }] as never });
    expect(sceneUsesAsset(normalDormant, 'asset_free', normalTmpl)).toBe(false);
    // FREE 場面の休眠 assetRefs・character は使用扱いにしない（freeLayout が実効表現）。
    const freeDormant = base({
      templateId: 'free_v1', sceneType: 'free',
      assetRefs: { slot: 'asset_ref' } as never,
      character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_pose' } as never,
      freeLayout: [] as never,
    });
    expect(sceneUsesAsset(freeDormant, 'asset_ref', freeTmpl)).toBe(false);
    expect(sceneUsesAsset(freeDormant, 'asset_pose', freeTmpl)).toBe(false);
  });

  it('sceneActiveAssetIds：template 未解決は通常扱い（assetRefs＋character・freeLayout は休眠）', () => {
    const s = base({
      assetRefs: { slot: 'A' } as never,
      character: { enabled: true, characterId: 'yuko', poseAssetId: 'P' } as never,
      freeLayout: [{ id: 'e', assetId: 'F' }] as never,
    });
    expect(sceneActiveAssetIds(s, undefined).sort()).toEqual(['A', 'P']); // freeLayout(F) は数えない
  });

  it('scenesUsingAsset は実効使用場面だけ返す（順序保持・テンプレでゲート）', () => {
    const scenes = [
      base({ sceneId: 's1', assetRefs: { slot: 'A' } as never }), // 通常＝A 使用
      base({ sceneId: 's2', assetRefs: {} as never }),
      base({ sceneId: 's3', templateId: 'free_v1', sceneType: 'free', freeLayout: [{ id: 'e', assetId: 'A' }] as never }), // FREE＝A 使用
      base({ sceneId: 's4', freeLayout: [{ id: 'e', assetId: 'A' }] as never }), // 通常＋休眠 freeLayout＝不使用
    ];
    const templateOf = (s: Scene): Template => (s.templateId === 'free_v1' ? freeTmpl : normalTmpl);
    expect(scenesUsingAsset(scenes, 'A', templateOf).map((s) => s.sceneId)).toEqual(['s1', 's3']);
    expect(scenesUsingAsset(scenes, 'Z', templateOf)).toEqual([]);
  });
});
