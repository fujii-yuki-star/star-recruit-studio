// シーンの「動画スロット」を見つける純粋ロジック（ADR-0006・step2b-Front）。
// slot 層に assetType=video の素材が割り当たっていれば、その層IDとクリップ設定を返す。
// MVP は1シーン1動画スロット（最初に見つかったもの）。複数スロットは ADR-0006 未解決#2。
import { DEFAULT_FIT } from '../../domain/constants';
import { ASSET_TYPE, SLOT_TYPE, type Fit } from '../../domain/enums';
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
}

/**
 * シーンの動画スロット（slot 層に assetType=video が割当）を返す。無ければ undefined。
 * @param assetById assetId → Asset 解決
 */
export function findVideoSlot(
  scene: Scene,
  template: Template,
  assetById: (id: string) => Asset | undefined,
): VideoSlotInfo | undefined {
  for (const layer of template.layers) {
    if (layer.type !== 'slot') continue;
    // 正典 11 §3.4/§5: slotType='image' のスロットは動画を受け付けない（image_or_video / video のみ）。
    if (layer.slotType === SLOT_TYPE.image) continue;
    const assetId = scene.assetRefs[layer.id];
    if (!assetId) continue;
    const asset = assetById(assetId);
    if (!asset || asset.assetType !== ASSET_TYPE.video) continue;
    const clip = asset.clip;
    return {
      slotLayerId: layer.id,
      clipRelPath: asset.filePath,
      fit: clip?.fit ?? layer.fit ?? DEFAULT_FIT,
      clipStartSec: clip?.startSec ?? 0,
      clipEndSec: clip?.endSec ?? undefined,
      // 音声が実在する場合のみ元音声ON（音声なしクリップで [1:a] を要求しない＝N-2）。
      useOriginalAudio: (clip?.useOriginalAudio ?? false) && (asset.metadata?.hasAudio ?? false),
      originalVolume: clip?.originalAudioVolume,
    };
  }
  return undefined;
}
