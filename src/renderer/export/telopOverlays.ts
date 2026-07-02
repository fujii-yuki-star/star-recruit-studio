// タイムラインのテロップ（timelineOverlay）を書き出し用の「帯PNG＋表示区間」へ（ADR-0018 テロップ実描画）。
// 帯は overlayTelopItem（プレビューと同一ジオメトリ・単一参照元）を透過SVG→PNGに焼き、Rust が結合後の動画へ
// overlay（enable='between(t,S,E)'）で合成する。グローバル秒は compileTimeline の秒＝xfade 重なり込みの実効時間軸と一致。
import { compileTimeline } from '../../domain/project/compileTimeline';
import type { Project } from '../../domain/project/types';
import { dimsForOrientation } from '../../domain/constants';
import type { TelopOverlayInput } from '../../infrastructure/ffmpegExport';
import { overlayTelopItem } from '../layout';
import type { SceneLayout } from '../layout';
import { layoutToSvg } from '../sceneSvg';
import { svgToPngDataUrl } from './rasterize';

export interface BuildTelopOverlaysOptions {
  /** 出力解像度（未指定＝キャンバス実寸）。場面PNGと同じ流儀（レイアウトはキャンバス座標・ラスタライズで縮小）。 */
  outputSize?: { width: number; height: number };
  /** 動画全体のフォント（テロップは場面横断のため動画全体フォントで焼く）。 */
  fontFamily?: string;
}

/** overlay テロップを帯PNG（透過・出力解像度）＋グローバル表示区間の配列へ焼く。無ければ空配列。 */
export async function buildTelopOverlays(
  project: Project,
  opts: BuildTelopOverlaysOptions = {},
): Promise<TelopOverlayInput[]> {
  const canvas = dimsForOrientation(project.videoSettings.aspectRatio);
  const width = opts.outputSize?.width ?? canvas.width;
  const height = opts.outputSize?.height ?? canvas.height;
  const timeline = compileTimeline(project);
  const out: TelopOverlayInput[] = [];
  for (const c of timeline.tracks.telop) {
    if (c.origin !== 'overlay' || !c.label) continue;
    // 帯だけの透過レイアウト（backgroundColor は transparent 指定で未使用）。credit は渡さない（本編側に付く）。
    const layout: SceneLayout = {
      width: canvas.width,
      height: canvas.height,
      backgroundColor: '#000000',
      items: [overlayTelopItem(canvas.width, canvas.height, c.label)],
    };
    const svg = layoutToSvg(layout, { transparent: true, fontFamily: opts.fontFamily });
    out.push({ pngBase64: await svgToPngDataUrl(svg, width, height), startSec: c.startSec, endSec: c.endSec });
  }
  return out;
}
