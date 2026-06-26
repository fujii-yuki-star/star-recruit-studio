// シーンの「動画スロット」を見つける純粋ロジック（ADR-0006・step2b-Front）。
// 通常テンプレ：slot 層に assetType=video の素材（assetRefs）が割り当たっていれば、その層IDとクリップ設定を返す。
// FREE テンプレ：freeLayout の slot 要素に動画 assetId が割り当たっていれば、その要素IDを返す（ADR-0008 Phase 4c）。
// いずれも返す slotLayerId は layout アイテムの id＝splitVideoSceneSvg が矩形/分割を id で解決する（Rust は無改修）。
// MVP は1シーン1動画（最初に見つかったもの）。複数は ADR-0006 未解決#2。
import { DEFAULT_FIT, SPEED_DEFAULT } from '../../domain/constants';
import { clampSpeed } from '../../domain/asset/clip';
import { ASSET_TYPE, FREE_CATEGORY, FREE_ELEMENT_KIND, SLOT_TYPE, type Fit } from '../../domain/enums';
import type { Asset, Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';

export interface VideoSlotInfo {
  /** 動画スロット層の id（下/上分割の境界・splitVideoSceneSvg に渡す）。 */
  slotLayerId: string;
  /** クリップのプロジェクト相対パス（asset.filePath）。Rust がファイルとして読む。 */
  clipRelPath: string;
  fit: Fit;
  clipStartSec: number;
  clipEndSec?: number;
  /** 元動画音声を使うか。clip 設定 かつ 実際に音声がある(metadata.hasAudio)ときだけ true（N-2）。 */
  useOriginalAudio: boolean;
  originalVolume?: number;
  /** 再生速度（0.5–2.0・clampSpeed 済み）。1.0=等速。 */
  speed: number;
}

// 動画 Asset と layout アイテム id から VideoSlotInfo を組み立てる（通常スロット/FREE 共通）。
// クリップ設定（範囲・速度・元音声）は Asset 単位（asset.clip）。fitFallback は通常=layer.fit / FREE=el.fit。
function toVideoSlotInfo(id: string, asset: Asset, fitFallback: Fit | undefined): VideoSlotInfo {
  const clip = asset.clip;
  return {
    slotLayerId: id,
    clipRelPath: asset.filePath,
    fit: clip?.fit ?? fitFallback ?? DEFAULT_FIT,
    clipStartSec: clip?.startSec ?? 0,
    clipEndSec: clip?.endSec, // endSec?: number（null なし）ゆえ ?? undefined は不要

    // 音声が実在する場合のみ元音声ON（音声なしクリップで [1:a] を要求しない＝N-2）。
    useOriginalAudio: (clip?.useOriginalAudio ?? false) && (asset.metadata?.hasAudio ?? false),
    originalVolume: clip?.originalAudioVolume,
    speed: clampSpeed(clip?.speed ?? SPEED_DEFAULT),
  };
}

/**
 * シーンの動画スロットを返す（無ければ undefined）。
 * FREE 場面は freeLayout の slot 要素（assetId 直接参照）、通常テンプレは slot 層＋assetRefs を見る。
 * @param assetById assetId → Asset 解決
 */
export function findVideoSlot(
  scene: Scene,
  template: Template,
  assetById: (id: string) => Asset | undefined,
): VideoSlotInfo | undefined {
  // FREE 場面：freeLayout の slot 要素から動画を探す（要素 id を slotLayerId に＝矩形は layout が同 id で持つ）。
  if (template.category === FREE_CATEGORY) {
    for (const el of scene.freeLayout ?? []) {
      if (el.kind !== FREE_ELEMENT_KIND.slot || !el.assetId) continue;
      const asset = assetById(el.assetId);
      if (!asset || asset.assetType !== ASSET_TYPE.video) continue;
      return toVideoSlotInfo(el.id, asset, el.fit);
    }
    return undefined; // FREE は freeLayout のみ（通常の slot 層は持たない）
  }
  // 通常テンプレ：slot 層 + assetRefs。
  for (const layer of template.layers) {
    if (layer.type !== 'slot') continue;
    // 正典 11 §3.4/§5: slotType='image' のスロットは動画を受け付けない（image_or_video / video のみ）。
    if (layer.slotType === SLOT_TYPE.image) continue;
    const assetId = scene.assetRefs[layer.id];
    if (!assetId) continue;
    const asset = assetById(assetId);
    if (!asset || asset.assetType !== ASSET_TYPE.video) continue;
    return toVideoSlotInfo(layer.id, asset, layer.fit);
  }
  return undefined;
}
