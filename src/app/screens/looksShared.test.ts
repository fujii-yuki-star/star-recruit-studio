import { describe, expect, it } from 'vitest';
import type { Asset } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';
import { buildSampleScene } from './looksShared';

// 見本（管理画面）にプロジェクトの素材を勝手に流し込まない（ADR-0021 ①）。
// 背景/メイン素材/ロゴはテンプレ既定素材（layer.assetId・描画フォールバック）に委ね、無ければプレースホルダ。
const tmpl = (layers: Template['layers'], category: Template['category'] = 'opening'): Template => ({
  schemaVersion: '1.0', templateId: 't1', name: 'T', category, aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 }, layers,
});

const asset = (assetId: string, assetType: Asset['assetType']): Asset => ({
  assetId, assetType, displayName: assetId, filePath: `${assetId}.png`,
});

describe('buildSampleScene（見本）', () => {
  it('プロジェクトの画像/ロゴを background/slot/logo に流し込まない（ADR-0021 ①）', () => {
    const t = tmpl([
      { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 },
      { id: 'main', type: 'slot', x: 100, y: 100, w: 800, h: 600, zIndex: 10 },
      { id: 'logo', type: 'logo', x: 1600, y: 60, w: 200, h: 100, zIndex: 60 },
    ]);
    const scene = buildSampleScene(t, [asset('asset_img_001', 'image'), asset('asset_logo_001', 'logo')]);
    // 持ち主の素材は assetRefs に入らない（テンプレ既定素材＝layer.assetId のフォールバックに委ねる）。
    expect(scene.assetRefs.background).toBeUndefined();
    expect(scene.assetRefs.main).toBeUndefined();
    expect(scene.assetRefs.logo).toBeUndefined();
  });

  it('character レイヤーがあればゆうこを既定ポーズで見せる（演者＝持ち主写真ではない）', () => {
    const t = tmpl([
      { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 },
      { id: 'yuko', type: 'character', x: 1450, y: 600, w: 360, h: 420, zIndex: 40 },
    ]);
    const scene = buildSampleScene(t, [asset('yuko_001', 'yuko')]);
    expect(scene.character.enabled).toBe(true);
    expect(scene.character.poseAssetId).toBe('yuko_001');
  });

  it('FREE テンプレのサンプルはスロットを空にする（持ち主の写真を出さない）', () => {
    const t = tmpl([{ id: 'bg', type: 'background', x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }], 'free');
    const scene = buildSampleScene(t, [asset('asset_img_001', 'image')]);
    const slot = scene.freeLayout?.find((e) => e.kind === 'slot');
    expect(slot?.assetId).toBeNull();
  });
});
