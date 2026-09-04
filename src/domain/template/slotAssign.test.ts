import { describe, expect, it } from 'vitest';
import { assignableAssetsFor, emptySlotLayerIds, isAssignableToLayer, slotForAsset } from './slotAssign';
import type { Asset } from '../project/types';
import type { Layer } from './types';

const asset = (assetId: string, assetType: Asset['assetType']): Asset =>
  ({ assetId, assetType, displayName: assetId, filePath: `${assetId}.bin` }) as Asset;

const image = asset('asset_img', 'image');
const video = asset('asset_vid', 'video');
const logo = asset('asset_logo', 'logo');
const bgm = asset('asset_bgm', 'bgm');
const all = [image, video, logo, bgm];

const layer = (over: Partial<Layer>): Layer =>
  ({ id: 'l1', type: 'slot', x: 0, y: 0, w: 100, h: 100, ...over }) as Layer;

// 差し込み口に入れられる素材の規則（#512 段3）。**場面形式とタイムライン形式で同じ**（ADR-0026②）。
describe('isAssignableToLayer', () => {
  it('ロゴの層はロゴと写真だけ（動画は入れない）', () => {
    const l = layer({ type: 'logo' });
    expect(all.filter((a) => isAssignableToLayer(a, l))).toEqual([image, logo]);
  });

  // ⚠️ **写真だけの差し込み口に動画を入れない**（`11 §3.4/§5`）＝入れても静止画で描かれる。
  it('写真だけの差し込み口は写真だけ', () => {
    const l = layer({ slotType: 'image' });
    expect(all.filter((a) => isAssignableToLayer(a, l))).toEqual([image]);
  });

  it('動画だけの差し込み口は動画だけ', () => {
    const l = layer({ slotType: 'video' });
    expect(all.filter((a) => isAssignableToLayer(a, l))).toEqual([video]);
  });

  // ⚠️ **種別を決めていない差し込み口・背景の層は写真と動画の両方**（音は入らない）。
  it('種別を決めていない差し込み口・背景の層は写真と動画', () => {
    for (const l of [layer({}), layer({ type: 'background' })]) {
      expect(all.filter((a) => isAssignableToLayer(a, l))).toEqual([image, video]);
    }
  });

  it('音の素材はどの差し込み口にも入らない', () => {
    for (const l of [layer({}), layer({ type: 'logo' }), layer({ slotType: 'image' }), layer({ slotType: 'video' })]) {
      expect(isAssignableToLayer(bgm, l)).toBe(false);
    }
  });
});

describe('assignableAssetsFor', () => {
  it('渡された並びのまま絞る（画面の一覧と同じ順）', () => {
    expect(assignableAssetsFor(all, layer({}))).toEqual([image, video]);
    expect(assignableAssetsFor([video, image], layer({}))).toEqual([video, image]);
  });
});

// 押した素材を**どの差し込み口へ入れるか**（#1030）。
//
// ⚠️ **押しても何も起きない一覧を作らない**＝場面編集の左欄の素材タイルは表示専用で、
// 実際の差し替えは右欄の畳まれた節の中の名前の `<select>` だけだった。
describe('slotForAsset（#1030）', () => {
  const bg = layer({ id: 'background', type: 'background' });
  const main = layer({ id: 'main', type: 'slot' });
  const sub = layer({ id: 'sub', type: 'slot' });
  const logoLayer = layer({ id: 'logo', type: 'logo' });

  it('空いている差し込み口があれば、その先頭へ入れる', () => {
    expect(slotForAsset(image, [main, sub], { main: 'asset_x' })).toEqual({ layerId: 'sub', replacing: null });
  });

  it('層の順に見る（見た目パターンの並びをそのまま使う）', () => {
    expect(slotForAsset(image, [bg, main, sub], {})).toEqual({ layerId: 'background', replacing: null });
  });

  // ⚠️ **空きが無いときは黙って何もしない、にしない**（§2-5）＝置き換える相手を返し、呼ぶ側が確認を出す。
  it('空きが無ければ先頭（主役）を置き換える相手として返す', () => {
    expect(slotForAsset(image, [main, sub], { main: 'asset_a', sub: 'asset_b' })).toEqual({
      layerId: 'main',
      replacing: 'asset_a',
    });
  });

  // ⚠️ **入れられるかの規則は `<select>` の候補と共有**＝片方でだけ入る素材を作らない。
  it('入れられる差し込み口だけを見る（動画はロゴの層に入らない）', () => {
    expect(slotForAsset(video, [logoLayer, main], {})).toEqual({ layerId: 'main', replacing: null });
  });

  it('入れられる差し込み口が無ければ null（呼ぶ側が理由を出す）', () => {
    expect(slotForAsset(video, [logoLayer], {})).toBeNull();
    expect(slotForAsset(bgm, [main, sub], {})).toBeNull();
  });

  // ⚠️ **`null` を「空き」として扱う**＝「なし」を選んだ差し込み口は空いている。
  it('「なし」にした差し込み口は空きとして扱う', () => {
    expect(slotForAsset(image, [main, sub], { main: null, sub: 'asset_b' })).toEqual({
      layerId: 'main',
      replacing: null,
    });
  });
});

// 空いていて**そのまま動画に出てしまう**差し込み口（#1030 ④）。
//
// ⚠️ **「差し込み口」ぜんぶではない**＝描く側（`layoutScene`）を読むと、空のときの扱いは層の種類で違う。
describe('emptySlotLayerIds（#1030 ④）', () => {
  it('空の素材の差し込み口だけを挙げる', () => {
    const layers = [layer({ id: 'main', type: 'slot' }), layer({ id: 'sub', type: 'slot' })];
    expect(emptySlotLayerIds(layers, { main: 'asset_a' })).toEqual(['sub']);
  });

  // ⚠️ **空の背景は塗りになる**＝灰色の枠は出ないので問題ではない。
  it('空の背景は数えない（塗りになる）', () => {
    expect(emptySlotLayerIds([layer({ id: 'background', type: 'background' })], {})).toEqual([]);
  });

  // ⚠️ **空のロゴは何も置かれない**＝これも問題ではない。
  it('空のロゴは数えない（何も置かれない）', () => {
    expect(emptySlotLayerIds([layer({ id: 'logo', type: 'logo' })], {})).toEqual([]);
  });

  // ⚠️ **テンプレ既定素材（ADR-0021）で埋まっている口は空ではない**（描画と同じ解決順）。
  it('テンプレ既定素材で埋まっている口は数えない', () => {
    const layers = [layer({ id: 'main', type: 'slot', assetId: 'tmpl_asset_001' })];
    expect(emptySlotLayerIds(layers, {})).toEqual([]);
  });

  it('「なし」にした口は空として数える', () => {
    expect(emptySlotLayerIds([layer({ id: 'main', type: 'slot' })], { main: null })).toEqual(['main']);
  });
});

