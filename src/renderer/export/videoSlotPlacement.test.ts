import { describe, expect, it } from 'vitest';
import {
  videoSlotUnplaceable,
  unplaceableVideoSceneNumbers,
  videoSlotAfterAnimNeverPlays,
  afterAnimNoSettledSceneNumbers,
} from './videoSlotPlacement';
import type { Asset, ElementAnimation, Scene } from '../../domain/project/types';
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

// 動画スロットを対象にしたアニメ（keyframes [0, endSec]）。
const anim = (targetId: string, endSec: number): ElementAnimation =>
  ({ id: 'anim_001', sceneId: 's1', targetId, keyframes: [{ timeSec: 0, x: -100 }, { timeSec: endSec, x: 0 }] } as unknown as ElementAnimation);
// slot_1 に afterAnim を設定した場面（durationSec 可変）。
const sceneAfterAnim = (durationSec: number): Scene =>
  ({ ...sceneWithSlot(false), sceneId: 's1', durationSec, slotVideoStart: { slot_1: { mode: 'afterAnim' } } } as unknown as Scene);

describe('videoSlotAfterAnimNeverPlays（#444・afterAnim×settled 無しで動画が一度も再生されない）', () => {
  it('アニメが場面尺いっぱい（animEnd>=尺）＋afterAnim＝true（degenerate）', () => {
    expect(videoSlotAfterAnimNeverPlays(sceneAfterAnim(2), freeTemplate, assetById, [anim('slot_1', 2)])).toBe(true);
  });
  it('settled が残る（animEnd<尺）なら false（afterAnim もそこで再生される）', () => {
    expect(videoSlotAfterAnimNeverPlays(sceneAfterAnim(8), freeTemplate, assetById, [anim('slot_1', 1)])).toBe(false);
  });
  it('mode が afterAnim でない（delay/未設定）なら false', () => {
    const delayScene = { ...sceneAfterAnim(2), slotVideoStart: { slot_1: { mode: 'delay', delaySec: 1 } } } as unknown as Scene;
    expect(videoSlotAfterAnimNeverPlays(delayScene, freeTemplate, assetById, [anim('slot_1', 2)])).toBe(false);
    const noSpec = { ...sceneWithSlot(false), sceneId: 's1', durationSec: 2 } as unknown as Scene;
    expect(videoSlotAfterAnimNeverPlays(noSpec, freeTemplate, assetById, [anim('slot_1', 2)])).toBe(false);
  });
  it('スロットがアニメ対象でない（他要素だけ動く）なら false', () => {
    expect(videoSlotAfterAnimNeverPlays(sceneAfterAnim(2), freeTemplate, assetById, [anim('other_el', 2)])).toBe(false);
  });
});

describe('afterAnimNoSettledSceneNumbers（degenerate 場面の番号・1始まり）', () => {
  it('degenerate（afterAnim×settled 無し）な場面だけ番号を返す', () => {
    const templateById = new Map([['tpl_free', freeTemplate]]);
    const scenes = [
      { ...sceneAfterAnim(8), sceneId: 'a' } as Scene, // 1: settled あり＝OK
      { ...sceneAfterAnim(2), sceneId: 'b' } as Scene, // 2: degenerate
    ];
    const animsFor = (s: Scene): ElementAnimation[] => (s.sceneId === 'a' ? [anim('slot_1', 1)] : [anim('slot_1', 2)]);
    expect(afterAnimNoSettledSceneNumbers(scenes, templateById, assetById, animsFor)).toEqual([2]);
  });
});
