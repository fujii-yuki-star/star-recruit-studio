import { describe, expect, it } from 'vitest';
import { videoSlotUnplaceable, unplaceableVideoSceneNumbers } from './videoSlotPlacement';
import type { Asset, Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';

// FREE テンプレ（freeLayout の slot 要素が role='slot' のレイアウトアイテムになる）。
const freeTemplate = {
  schemaVersion: '1.0', templateId: 'tpl_free', name: 'free', category: 'free',
  aspectRatio: '16:9', canvas: { width: 1920, height: 1080 }, layers: [],
} as unknown as Template;

const videoAsset: Asset = {
  assetId: 'asset_v', assetType: 'video', displayName: 'v', filePath: 'assets/v.mp4',
} as unknown as Asset;
const assetById = (id: string): Asset | undefined => (id === 'asset_v' ? videoAsset : undefined);

const sceneWithSlot = (hidden: boolean): Scene =>
  ({
    sceneId: 's1', templateId: 'tpl_free', sceneType: 'opening', durationSec: 8, texts: {},
    freeLayout: [{ id: 'slot_1', kind: 'slot', assetId: 'asset_v', x: 100, y: 100, w: 800, h: 600, fit: 'cover', zIndex: 1, hidden }],
  } as unknown as Scene);

describe('videoSlotUnplaceable（#434・動画スロットがレイアウトへ配置できないか）', () => {
  it('配置できる（非表示でない）スロットは false', () => {
    expect(videoSlotUnplaceable(sceneWithSlot(false), freeTemplate, assetById)).toBe(false);
  });

  it('スロット要素を非表示にすると findVideoSlots は返すが layoutScene に出ず＝分割失敗＝true', () => {
    // 非表示スロット＝「動画があるのに配置できない」＝黙って静止画化してはいけない状態（#434）。
    expect(videoSlotUnplaceable(sceneWithSlot(true), freeTemplate, assetById)).toBe(true);
  });

  it('動画スロットが無い場面は false（対象外）', () => {
    const noSlot = { sceneId: 's', templateId: 'tpl_free', durationSec: 5, texts: {}, freeLayout: [] } as unknown as Scene;
    expect(videoSlotUnplaceable(noSlot, freeTemplate, assetById)).toBe(false);
  });
});

describe('unplaceableVideoSceneNumbers（分割失敗する場面の番号・1始まり）', () => {
  it('分割失敗する場面だけ番号（位置）を返す', () => {
    const templateById = new Map([['tpl_free', freeTemplate]]);
    const scenes = [
      { ...sceneWithSlot(false), sceneId: 'a' } as Scene, // 1: OK
      { ...sceneWithSlot(true), sceneId: 'b' } as Scene, // 2: 分割失敗
      { ...sceneWithSlot(false), sceneId: 'c' } as Scene, // 3: OK
    ];
    expect(unplaceableVideoSceneNumbers(scenes, templateById, assetById)).toEqual([2]);
  });

  it('テンプレ未解決の場面は対象外（別チェックが扱う）', () => {
    const scenes = [{ ...sceneWithSlot(true), templateId: 'missing' } as Scene];
    expect(unplaceableVideoSceneNumbers(scenes, new Map(), assetById)).toEqual([]);
  });
});
