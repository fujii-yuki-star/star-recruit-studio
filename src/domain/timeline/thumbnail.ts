// タイムライン形式の動画の「一覧に出す小さな絵」（#397 の続き・2026-10-20 実機）。純粋関数。
//
// ⚠️ 以前は場面形式だけが絵を作り、**タイムライン形式の動画は一覧で絵が無かった**（読めない道を渡して折れた絵が出ていた）。
// 何を描くかはここで決め、描くのはプレビューと同じ描画の核（`layoutTimelineAt` → `layoutToSvg`）に任せる（ADR-0001）。
import { ASSET_TYPE } from '../enums';
import { isVisualClip } from './clipKind';
import type { TimelineProject } from './types';

/**
 * 一覧の絵にする時刻＝**いちばん早く絵が出る時刻**（隠した列の部品は数えない）。絵の部品が1つも無ければ `null`（絵を作らない）。
 * ⚠️ 0 秒で切らない＝頭に何も置いていない動画（黒い画面）を絵にしない。
 */
export function timelineThumbnailTime(doc: TimelineProject): number | null {
  const hidden = new Set(doc.tracks.filter((t) => t.hidden).map((t) => t.id));
  let best: number | null = null;
  for (const c of doc.clips) {
    if (!isVisualClip(c) || hidden.has(c.trackId)) continue;
    if (best == null || c.startSec < best) best = c.startSec;
  }
  return best;
}

/**
 * 小さな絵に使う素材のファイル（相対パス）。写真は本体、**動画は取り込み時に作った小さな絵**（コマを取り出さない＝保存のたびに重くしない）。
 * 読めるものが無ければ `null`（その部品は描かれない＝一覧の飾りなので、それで止めない）。
 */
export function thumbnailSourcePath(doc: TimelineProject, assetId: string): string | null {
  const a = doc.assets.find((x) => x.assetId === assetId);
  if (!a) return null;
  if (a.assetType === ASSET_TYPE.image) return a.filePath;
  if (a.assetType === ASSET_TYPE.video) return a.thumbnailPath ?? null;
  return null;
}
