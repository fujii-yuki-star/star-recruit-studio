// タイムライン形式の動画の「一覧に出す小さな絵」を焼く（2026-10-20 実機・#397 の続き）。
//
// ⚠️ **描画は本番と同じ経路**（`layoutTimelineAt` → `layoutToSvg` → `svgToPngDataUrl`）＝一覧の絵と実際の動画がずれない（ADR-0001）。
// ⚠️ **失敗しても呼ぶ側の保存を止めない**（`null` を返す）＝絵が無くても一覧は開ける（印に戻る）。
import { layoutTimelineAt } from '../timelineLayout';
import { layoutToSvg } from '../sceneSvg';
import { svgToPngDataUrl } from './rasterize';
import { PROJECT_THUMBNAIL_WIDTH } from '../../domain/project/thumbnail';
import { timelineThumbnailTime } from '../../domain/timeline/thumbnail';
import type { TimelineProject } from '../../domain/timeline/types';
import type { Template } from '../../domain/template/types';

export interface TimelineThumbnailOptions {
  templateOf: (templateId: string) => Template | undefined;
  /** 素材の絵（data URL）。**使う素材だけ**問い合わせる（読み込みは呼ぶ側）。 */
  loadAssetSrc: (assetId: string) => Promise<string | undefined>;
  /** 見た目パターンの既定素材（data URL）。 */
  templateAssetSrc: (assetId: string) => string | undefined;
  fontFamily?: string;
}

/**
 * 一覧の絵を焼く。`key`＝描く中身の印（同じなら焼き直さなくてよい）。描く部品が無い・描けなければ `null`。
 * ⚠️ 印は**絵を読む前**に決める＝変わっていなければ素材を1枚も読まずに済む。
 */
export function timelineThumbnailKey(doc: TimelineProject, templateOf: TimelineThumbnailOptions['templateOf']): string | null {
  const t = timelineThumbnailTime(doc);
  if (t == null) return null;
  const layout = layoutTimelineAt(doc, t, { templateOf });
  if (layout.items.length === 0) return null;
  return JSON.stringify({ t, layout, fontId: doc.videoSettings.fontId ?? null });
}

export async function renderTimelineThumbnail(doc: TimelineProject, opts: TimelineThumbnailOptions): Promise<string | null> {
  try {
    const t = timelineThumbnailTime(doc);
    if (t == null) return null;
    const layout = layoutTimelineAt(doc, t, { templateOf: opts.templateOf });
    if (layout.items.length === 0) return null;
    const ids = [...new Set(layout.items.flatMap((i) => ('assetId' in i && typeof i.assetId === 'string' ? [i.assetId] : [])))];
    const src = new Map<string, string>();
    for (const id of ids) {
      const s = opts.templateAssetSrc(id) ?? (await opts.loadAssetSrc(id));
      if (s) src.set(id, s);
    }
    const svg = layoutToSvg(layout, {
      assetSrc: (id) => (id ? src.get(id) : undefined),
      ...(opts.fontFamily ? { fontFamily: opts.fontFamily } : {}),
    });
    // 縦横比はキャンバスから採る（縦型でも潰れない）。
    const height = Math.max(1, Math.round((PROJECT_THUMBNAIL_WIDTH * layout.height) / layout.width));
    return await svgToPngDataUrl(svg, PROJECT_THUMBNAIL_WIDTH, height);
  } catch {
    return null;
  }
}
