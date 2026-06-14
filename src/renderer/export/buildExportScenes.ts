// 全場面を「共有レイアウト → SVG → PNG(data URL)」に焼き、書き出し入力を組み立てる（ADR-0001/0004）。
// 動画ありシーンは下/上2枚の透過PNG＋クリップ情報を渡す（ADR-0006）。FFmpeg呼び出しは infrastructure に分離。
import type { Fit } from '../../domain/enums';
import type { Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';
import { layoutScene } from '../layout';
import { layoutToSvg } from '../sceneSvg';
import { svgToPngDataUrl } from './rasterize';
import { splitVideoSceneSvg } from './videoSceneSplit';
import type { VideoSlotInfo } from './findVideoSlot';

/** 動画ありシーンの書き出し入力（infrastructure の ExportVideoInput と構造一致）。 */
export interface ExportVideoData {
  belowPngBase64: string;
  abovePngBase64: string;
  clipRelPath: string;
  slotX: number;
  slotY: number;
  slotW: number;
  slotH: number;
  fit: Fit;
  clipStartSec: number;
  clipEndSec?: number;
  useOriginalAudio: boolean;
  originalVolume?: number;
}

/** 書き出し1場面ぶんの入力（infrastructure の ExportSceneInput と構造一致）。 */
export interface ExportSceneData {
  pngBase64?: string;
  durationSec: number;
  audioBase64?: string;
  narrationVolume?: number;
  video?: ExportVideoData;
}

/**
 * 場面ごとのナレーション音声と解決済み音量(§6)を返すコールバック。
 * narrationVolume は常に返し、audioBase64 が無い（undefined）場面は無音になる。
 */
export type NarrationFor = (
  scene: Scene,
) => { audioBase64?: string; narrationVolume: number } | undefined;

/** 場面ごとの動画スロット情報を返すコールバック（undefined＝静止画シーン）。 */
export type VideoSlotFor = (scene: Scene) => VideoSlotInfo | undefined;

/**
 * 各場面をプレビューと同一のSVGで実寸PNG化し、ナレーション音声を添える。テンプレ未解決の場面はスキップ。
 * 動画スロットがある場面は下/上2枚PNG＋クリップ情報（ADR-0006）。onProgress(done, total) で進捗通知。
 */
export async function buildExportScenes(
  scenes: Scene[],
  templateById: Map<string, Template>,
  assetSrc: (assetId: string | null) => string | undefined,
  narrationFor?: NarrationFor,
  videoSlotFor?: VideoSlotFor,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportSceneData[]> {
  const out: ExportSceneData[] = [];
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    const template = templateById.get(scene.templateId);
    if (template) {
      const layout = layoutScene(scene, template);
      const narration = narrationFor?.(scene);
      const videoSlot = videoSlotFor?.(scene);
      const split = videoSlot ? splitVideoSceneSvg(layout, videoSlot.slotLayerId, assetSrc) : null;
      const { width, height } = template.canvas;
      if (videoSlot && split) {
        // 動画ありシーン：下/上2枚の透過PNG＋クリップ情報（ADR-0006）。
        const belowPngBase64 = await svgToPngDataUrl(split.belowSvg, width, height);
        const abovePngBase64 = await svgToPngDataUrl(split.aboveSvg, width, height);
        out.push({
          durationSec: scene.durationSec,
          audioBase64: narration?.audioBase64,
          narrationVolume: narration?.narrationVolume,
          video: {
            belowPngBase64,
            abovePngBase64,
            clipRelPath: videoSlot.clipRelPath,
            slotX: split.slot.x,
            slotY: split.slot.y,
            slotW: split.slot.w,
            slotH: split.slot.h,
            fit: videoSlot.fit,
            clipStartSec: videoSlot.clipStartSec,
            clipEndSec: videoSlot.clipEndSec,
            useOriginalAudio: videoSlot.useOriginalAudio,
            originalVolume: videoSlot.originalVolume,
          },
        });
      } else {
        if (videoSlot && !split) {
          // slotLayerId がレイアウトに見つからない等で分割失敗 → 静止画として書き出す（原因追跡のため開発ログ）。
          console.warn(
            '[buildExportScenes] 動画スロットの分割に失敗したため静止画で書き出します。slotLayerId:',
            videoSlot.slotLayerId,
          );
        }
        // 静止画シーン（従来）。
        const pngBase64 = await svgToPngDataUrl(layoutToSvg(layout, { assetSrc }), width, height);
        out.push({
          pngBase64,
          durationSec: scene.durationSec,
          audioBase64: narration?.audioBase64,
          narrationVolume: narration?.narrationVolume,
        });
      }
    }
    onProgress?.(i + 1, scenes.length);
  }
  return out;
}
