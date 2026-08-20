import { describe, expect, it } from 'vitest';
import { assignableAssetsFor, isAssignableToLayer } from './slotAssign';
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
