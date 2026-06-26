import { describe, expect, it } from 'vitest';
import type { Asset, Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';
import { findVideoSlot } from './findVideoSlot';

const template = {
  layers: [
    { id: 'bg', type: 'background', x: 0, y: 0, w: 1920, h: 1080 },
    { id: 'mainVisual', type: 'slot', slotType: 'image_or_video', x: 80, y: 140, w: 1040, h: 800, fit: 'cover' },
  ],
} as unknown as Template;

function scene(slotAssetId: string | null): Scene {
  return { assetRefs: { mainVisual: slotAssetId } } as unknown as Scene;
}

const videoAsset: Asset = {
  assetId: 'asset_v',
  assetType: 'video',
  displayName: '会社紹介クリップ',
  filePath: 'assets/asset_v.mp4',
  clip: { startSec: 2, endSec: 8, useOriginalAudio: true, originalAudioVolume: 0.3, fit: 'contain' },
  metadata: { hasAudio: true },
};
const imageAsset: Asset = {
  assetId: 'asset_i',
  assetType: 'image',
  displayName: '写真',
  filePath: 'assets/asset_i.png',
};
const by = (assets: Asset[]) => (id: string) => assets.find((a) => a.assetId === id);

describe('findVideoSlot', () => {
  it('slot に動画素材があれば層ID＋クリップ設定を返す', () => {
    const r = findVideoSlot(scene('asset_v'), template, by([videoAsset]));
    expect(r).toEqual({
      slotLayerId: 'mainVisual',
      clipRelPath: 'assets/asset_v.mp4',
      fit: 'contain', // clip.fit 優先
      clipStartSec: 2,
      clipEndSec: 8,
      useOriginalAudio: true,
      originalVolume: 0.3,
      speed: 1,
    });
  });

  it('slot が画像素材なら undefined', () => {
    expect(findVideoSlot(scene('asset_i'), template, by([imageAsset]))).toBeUndefined();
  });

  it('slot 未割当なら undefined', () => {
    expect(findVideoSlot(scene(null), template, by([videoAsset]))).toBeUndefined();
  });

  it('音声なしクリップ(hasAudio=false)は useOriginalAudio=false（N-2）', () => {
    const noAudio: Asset = { ...videoAsset, metadata: { hasAudio: false } };
    expect(findVideoSlot(scene('asset_v'), template, by([noAudio]))?.useOriginalAudio).toBe(false);
  });

  it('clip.fit 未指定なら layer.fit にフォールバック', () => {
    const noClipFit: Asset = { ...videoAsset, clip: { useOriginalAudio: false } };
    expect(findVideoSlot(scene('asset_v'), template, by([noClipFit]))?.fit).toBe('cover'); // layer.fit
  });

  it("slotType='image' のスロットは動画素材でも undefined（11 §3.4）", () => {
    const imageOnly = {
      layers: [
        { id: 'photo', type: 'slot', slotType: 'image', x: 0, y: 0, w: 100, h: 100, fit: 'cover' },
      ],
    } as unknown as Template;
    const sc = { assetRefs: { photo: 'asset_v' } } as unknown as Scene;
    expect(findVideoSlot(sc, imageOnly, by([videoAsset]))).toBeUndefined();
  });

  it('clip.speed が設定されていれば clampSpeed 適用済みで返す', () => {
    const withSpeed: Asset = { ...videoAsset, clip: { ...videoAsset.clip, speed: 1.5 } };
    expect(findVideoSlot(scene('asset_v'), template, by([withSpeed]))?.speed).toBe(1.5);
  });
});

const freeTemplate = {
  category: 'free',
  layers: [{ id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 }],
} as unknown as Template;
const freeScene = (freeLayout: unknown[]): Scene =>
  ({ assetRefs: {}, freeLayout } as unknown as Scene);

describe('findVideoSlot（FREE 自由配置・ADR-0008 Phase 4c）', () => {
  it('freeLayout の slot 要素に動画があれば要素IDを slotLayerId に返す', () => {
    const sc = freeScene([
      { id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 100, text: 'a' },
      { id: 'free_002', kind: 'slot', x: 100, y: 100, w: 800, h: 600, assetId: 'asset_v', fit: 'cover' },
    ]);
    const r = findVideoSlot(sc, freeTemplate, by([videoAsset]));
    expect(r?.slotLayerId).toBe('free_002'); // layout の同 id アイテムが矩形を持つ
    expect(r?.clipRelPath).toBe('assets/asset_v.mp4');
    expect(r?.fit).toBe('contain'); // clip.fit 優先
    expect(r?.clipStartSec).toBe(2);
    expect(r?.speed).toBe(1);
  });

  it('slot 要素が画像なら undefined', () => {
    const sc = freeScene([{ id: 'free_001', kind: 'slot', x: 0, y: 0, w: 100, h: 100, assetId: 'asset_i', fit: 'cover' }]);
    expect(findVideoSlot(sc, freeTemplate, by([imageAsset]))).toBeUndefined();
  });

  it('slot 要素の assetId が null（空スロット）なら undefined', () => {
    const sc = freeScene([{ id: 'free_001', kind: 'slot', x: 0, y: 0, w: 100, h: 100, assetId: null }]);
    expect(findVideoSlot(sc, freeTemplate, by([videoAsset]))).toBeUndefined();
  });

  it('text/shape のみ・freeLayout 空・未設定はいずれも undefined', () => {
    expect(findVideoSlot(freeScene([{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 10, h: 10, text: 'a' }]), freeTemplate, by([videoAsset]))).toBeUndefined();
    expect(findVideoSlot(freeScene([]), freeTemplate, by([videoAsset]))).toBeUndefined();
    expect(findVideoSlot({ assetRefs: {} } as unknown as Scene, freeTemplate, by([videoAsset]))).toBeUndefined();
  });

  it('動画 slot 要素が複数あれば最初の1つ（MVP 1場面1動画）', () => {
    const sc = freeScene([
      { id: 'free_001', kind: 'slot', x: 0, y: 0, w: 100, h: 100, assetId: 'asset_v', fit: 'cover' },
      { id: 'free_002', kind: 'slot', x: 0, y: 0, w: 100, h: 100, assetId: 'asset_v2', fit: 'cover' },
    ]);
    const v2: Asset = { ...videoAsset, assetId: 'asset_v2' };
    expect(findVideoSlot(sc, freeTemplate, by([videoAsset, v2]))?.slotLayerId).toBe('free_001');
  });

  it('clip.fit 未指定なら el.fit にフォールバック', () => {
    const noClipFit: Asset = { ...videoAsset, clip: { useOriginalAudio: false } };
    const sc = freeScene([{ id: 'free_001', kind: 'slot', x: 0, y: 0, w: 100, h: 100, assetId: 'asset_v', fit: 'stretch' }]);
    expect(findVideoSlot(sc, freeTemplate, by([noClipFit]))?.fit).toBe('stretch'); // el.fit
  });
});
