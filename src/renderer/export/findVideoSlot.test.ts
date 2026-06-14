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
});
