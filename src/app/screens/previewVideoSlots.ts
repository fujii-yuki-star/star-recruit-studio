// 仕上がり確認の実映像再生（#432）：解決済みクリップURLから ScenePreview へ渡す再生情報を組む純粋ロジック。
// 場面送りで URL 解決が終わるまでの間、同じ slotLayerId（例 mainVisual）に前場面の旧URLがヒットして
// 前の動画を一瞬流す事故を防ぐため、**解決時の clipRelPath と現在スロットの clipRelPath が一致する場合だけ**採用する（#432 P2）。
import type { VideoSlotInfo } from '../../renderer/export/findVideoSlot';
import type { VideoSlotPlayback } from '../components/ScenePreview';

/** 解決済みクリップURL（slotLayerId→{url, relPath}）を、現在のスロット群に照合して再生情報へ組む。 */
export function buildVideoPlaybackSlots(
  videoSlots: VideoSlotInfo[],
  resolved: Record<string, { url: string; relPath: string }>,
): VideoSlotPlayback[] {
  return videoSlots
    // relPath が一致するときだけ採用＝場面送り直後の旧URL（別クリップ）を使わない。
    .filter((s) => resolved[s.slotLayerId]?.relPath === s.clipRelPath)
    .map((s) => ({
      slotLayerId: s.slotLayerId,
      clipUrl: resolved[s.slotLayerId].url,
      clipStartSec: s.clipStartSec,
      clipEndSec: s.clipEndSec,
      speed: s.speed,
      fit: s.fit,
      useOriginalAudio: s.useOriginalAudio,
      originalVolume: s.originalVolume,
    }));
}
