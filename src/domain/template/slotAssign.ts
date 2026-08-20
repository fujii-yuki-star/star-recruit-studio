// 差し込み口に**入れられる素材**の規則（#512 段3）。純粋・副作用なし。
//
// ⚠️ **場面形式とタイムライン形式で同じ規則**（ADR-0026②）＝同じ枠なのに画面によって選べるものが
// 違う、を作らない。以前はタイムライン側だけ「動画は出さない」で絞っていたが、差し込み口の動画も
// 映るようになった（段3）ので理由が消えた＝規則を1つに寄せる。
import { ASSET_TYPE, LAYER_TYPE, SLOT_TYPE } from '../enums';
import type { Asset } from '../project/types';
import type { Layer } from './types';

/**
 * その層の差し込み口に入れられる素材か。
 * - ロゴの層＝ロゴか写真
 * - 写真だけの差し込み口＝写真／動画だけの差し込み口＝動画
 * - それ以外（背景・種別を決めていない差し込み口）＝写真か動画
 */
export function isAssignableToLayer(asset: Asset, layer: Layer): boolean {
  if (layer.type === LAYER_TYPE.logo) return asset.assetType === ASSET_TYPE.logo || asset.assetType === ASSET_TYPE.image;
  if (layer.slotType === SLOT_TYPE.image) return asset.assetType === ASSET_TYPE.image;
  if (layer.slotType === SLOT_TYPE.video) return asset.assetType === ASSET_TYPE.video;
  return asset.assetType === ASSET_TYPE.image || asset.assetType === ASSET_TYPE.video;
}

/** その層の差し込み口に入れられる素材の一覧（並びは渡された順＝呼び出し側の一覧と同じ）。 */
export function assignableAssetsFor(assets: readonly Asset[], layer: Layer): Asset[] {
  return assets.filter((a) => isAssignableToLayer(a, layer));
}
