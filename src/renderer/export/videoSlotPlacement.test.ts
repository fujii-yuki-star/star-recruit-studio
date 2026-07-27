import { describe, expect, it } from 'vitest';
import {
  videoSlotUnplaceable,
  unplaceableVideoSceneNumbers,
  videoSlotAfterAnimNeverPlays,
  afterAnimNoSettledSceneNumbers,
  afterAnimNeverPlaysForSlots,
} from './videoSlotPlacement';
import { findVideoSlots } from './findVideoSlot';
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

  // #547 P2-5 レビュー：掛け合い×動画はアニメ自体が効かず**静止で完走する**（#469）＝この degenerate にならない。
  // ここで false にしないと「書き出しは成功するのに公開前チェックが主ボタンを止める」＝書き出し画面へ到達できない
  // 行き止まりを作る（公開前チェックが唯一の導線）。書き出し側と同じ sceneAnimationActive を共有して防ぐ。
  it('掛け合い（scene.lines あり）×動画なら false（アニメが効かず静止で書き出せる＝止めない）', () => {
    const dialogue = {
      ...sceneAfterAnim(2),
      lines: [{ lineId: 'l1', text: 'あ', status: 'generated' }],
    } as unknown as Scene;
    expect(videoSlotAfterAnimNeverPlays(dialogue, freeTemplate, assetById, [anim('slot_1', 2)])).toBe(false);
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

// #588：公開前チェックと書き出しが「止める条件」を**同じ関数**で判断することを固定する（`15 §3` の「同値に保つ」）。
// 以前は同じ条件式を両側に書き写しており、片方だけ条件が変わると
//  - 過剰ブロック＝公開前チェックで止まるのに書き出しは通る（行き止まり）
//  - 取りこぼし＝公開前チェックを通ったのに書き出しが §2-5 エラーで落ちる（手戻り）
// のどちらかになる。ここでは両入口が同一の判定本体を通ることを、代表ケース網羅で突き合わせる。
describe('precheck と書き出しの停止条件が同値（#588 ドリフトガード）', () => {
  // [説明, 場面, その場面のアニメ] の代表ケース（degenerate / settled あり / mode 違い / 非アニメ / 掛け合い）。
  const cases: [string, Scene, ElementAnimation[]][] = [
    ['degenerate（アニメが尺いっぱい＋afterAnim）', sceneAfterAnim(2), [anim('slot_1', 2)]],
    ['settled が残る', sceneAfterAnim(8), [anim('slot_1', 1)]],
    ['mode が delay', { ...sceneAfterAnim(2), slotVideoStart: { slot_1: { mode: 'delay', delaySec: 1 } } } as unknown as Scene, [anim('slot_1', 2)]],
    ['開始指定なし', { ...sceneWithSlot(false), sceneId: 's1', durationSec: 2 } as unknown as Scene, [anim('slot_1', 2)]],
    ['スロットがアニメ対象でない', sceneAfterAnim(2), [anim('other_el', 2)]],
    ['アニメなし', sceneAfterAnim(2), []],
    ['掛け合い×動画（静止で完走＝止めない）', { ...sceneAfterAnim(2), lines: [{ lineId: 'l1', text: 'あ', status: 'generated' }] } as unknown as Scene, [anim('slot_1', 2)]],
  ];

  it.each(cases)('%s：precheck の判定と書き出しの判定が一致する', (_label, scene, anims) => {
    // precheck 入口（テンプレ＋素材からスロットを解決）と、書き出し入口（解決済みスロットを受け取る）。
    const viaPrecheck = videoSlotAfterAnimNeverPlays(scene, freeTemplate, assetById, anims);
    const viaExport = afterAnimNeverPlaysForSlots(scene, findVideoSlots(scene, freeTemplate, assetById), anims);
    expect(viaExport).toBe(viaPrecheck);
  });

  it('少なくとも1件は true・1件は false（両方向を実際に踏んでいる＝空振りで一致していない）', () => {
    const verdicts = cases.map(([, s, a]) => videoSlotAfterAnimNeverPlays(s, freeTemplate, assetById, a));
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });
});
