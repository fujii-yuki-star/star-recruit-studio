// 全場面を「共有レイアウト → SVG → PNG(data URL)」に焼き、書き出し入力を組み立てる（ADR-0001/0004）。
// FFmpeg呼び出しは infrastructure/ffmpegExport に分離。ここは renderer の責務（描画のみ）。
import type { Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';
import { layoutScene } from '../layout';
import { layoutToSvg } from '../sceneSvg';
import { svgToPngDataUrl } from './rasterize';

/** 書き出し1場面ぶんの入力（infrastructure の ExportSceneInput と構造一致）。 */
export interface ExportSceneData {
  pngBase64: string;
  durationSec: number;
}

/**
 * 各場面をプレビューと同一のSVGで実寸PNG化する。テンプレ未解決の場面はスキップ。
 * onProgress(done, total) で進捗を通知する。
 */
export async function buildExportScenes(
  scenes: Scene[],
  templateById: Map<string, Template>,
  assetSrc: (assetId: string | null) => string | undefined,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportSceneData[]> {
  const out: ExportSceneData[] = [];
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    const template = templateById.get(scene.templateId);
    if (template) {
      const svg = layoutToSvg(layoutScene(scene, template), { assetSrc });
      const pngBase64 = await svgToPngDataUrl(svg, template.canvas.width, template.canvas.height);
      out.push({ pngBase64, durationSec: scene.durationSec });
    }
    onProgress?.(i + 1, scenes.length);
  }
  return out;
}
