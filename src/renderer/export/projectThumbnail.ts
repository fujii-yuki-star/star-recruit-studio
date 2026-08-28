// 一覧に出すプロジェクトの小さな絵を焼く（#397）。
//
// ⚠️ **描画は本番と同じ経路**（`layoutScene` → `layoutToSvg` → `svgToPngDataUrl`）＝
// 一覧の絵と実際の動画がずれない。小さくするのは**焼く寸法**だけ（ADR-0001）。
// ⚠️ **失敗しても呼ぶ側の保存を止めない**（`null` を返す）＝絵が無くても一覧は開ける。
import { layoutScene } from '../layout';
import { layoutToSvg } from '../sceneSvg';
import { svgToPngDataUrl } from './rasterize';
import { fontFamilyForId, resolveFontId } from '../../domain/font/fontCatalog';
import { PROJECT_THUMBNAIL_WIDTH } from '../../domain/project/thumbnail';
import type { Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';

/** 先頭の場面を小さな PNG（data URL）にする。描けなければ `null`。 */
export async function renderProjectThumbnail(
  scene: Scene,
  template: Template,
  assetSrc: (assetId: string | null) => string | undefined,
  projectFontId: string | null | undefined,
): Promise<string | null> {
  try {
    const layout = layoutScene(scene, template);
    const svg = layoutToSvg(layout, {
      assetSrc,
      fontFamily: fontFamilyForId(resolveFontId(scene.fontId, projectFontId)),
    });
    // 縦横比は見た目パターンのキャンバスから採る（縦型でも潰れない）。
    const height = Math.max(1, Math.round((PROJECT_THUMBNAIL_WIDTH * layout.height) / layout.width));
    return await svgToPngDataUrl(svg, PROJECT_THUMBNAIL_WIDTH, height);
  } catch {
    return null;
  }
}
