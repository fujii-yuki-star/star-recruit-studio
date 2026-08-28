// 動画から切り出した静止画（#349）。
import { describe, expect, it } from 'vitest';
import { frameAssetName, newFrameAsset } from './assetFile';
import { ASSET_TYPE } from '../enums';

describe('frameAssetName', () => {
  /** ⚠️ 一覧で見分けられる名前にする（「無題」が並ばない）。秒は読める形（分:秒）で書く（§2-3）。 */
  it('元の動画の名前と、切り出した時間から作る', () => {
    expect(frameAssetName('会社紹介', 75)).toBe('会社紹介（1:15）');
    expect(frameAssetName('会社紹介', 5)).toBe('会社紹介（0:05）');
    expect(frameAssetName('会社紹介', 0)).toBe('会社紹介（0:00）');
  });

  it('秒は切り捨てる（小数を画面に出さない）', () => {
    expect(frameAssetName('あ', 9.87)).toBe('あ（0:09）');
  });

  it('負の時間は 0 として扱う（壊れた値で変な名前にしない）', () => {
    expect(frameAssetName('あ', -3)).toBe('あ（0:00）');
  });

  it('元の名前が無くても無名の行を作らない', () => {
    expect(frameAssetName('', 0)).not.toBe('（0:00）');
  });
});

describe('newFrameAsset', () => {
  it('普通の写真素材として作る（PNG・assets 直下）', () => {
    const { asset, fileName } = newFrameAsset('会社紹介', 30, [], 'asset_007');
    expect(asset).toEqual({
      assetId: 'asset_007',
      assetType: ASSET_TYPE.image,
      displayName: '会社紹介（0:30）',
      filePath: 'assets/asset_007.png',
    });
    expect(fileName).toBe('asset_007.png');
  });

  /** ⚠️ 切り出しは原寸のまま出すので、非可逆の形式にしない。 */
  it('形式は PNG で固定（縮めない・劣化させない）', () => {
    expect(newFrameAsset('あ', 0, [], 'asset_001').fileName.endsWith('.png')).toBe(true);
  });

  it('番号を渡さなければ既存とかぶらない番号を採る', () => {
    const { asset } = newFrameAsset('あ', 0, ['asset_001', 'asset_002']);
    expect(asset.assetId).toBe('asset_003');
  });
});
