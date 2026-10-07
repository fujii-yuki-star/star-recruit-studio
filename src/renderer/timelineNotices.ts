// タイムライン形式の「書き出しは止めないが、知らせたい」注意（#1366）。
//
// ⚠️ **判定は描画と同じものを通す**（ADR-0001）＝部品ごとに `layoutTimelineAt` が作ったアイテムを、
// 場面形式の公開前チェックと同じ `truncatedTexts`（`wrapText` で折り返して元の文と比べる）に通す。
import { truncatedTexts } from '../domain/project/precheckExtras';
import { isVisualClip } from '../domain/timeline/clipKind';
import type { Template } from '../domain/template/types';
import type { TimelineProject } from '../domain/timeline/types';
import { isItemOfClip, layoutTimelineAt } from './timelineLayout';

/**
 * 枠に入りきらず末尾が「…」になる文字（部品ごとに1つ・重複なし）。
 *
 * ⚠️ **部品の真ん中の時刻で見る**＝文字は部品の間変わらない（字幕も連動先の読み上げ文で一定）。
 * 隠した列・部品・まとまりは描かれないので数えない（`layoutTimelineAt` がそもそも出さない）。
 */
export function timelineTruncatedTexts(
  doc: TimelineProject,
  templateOf: (templateId: string) => Template | undefined,
): string[] {
  const out = new Set<string>();
  for (const clip of doc.clips) {
    if (!isVisualClip(clip)) continue;
    const at = clip.startSec + clip.durationSec / 2;
    const items = layoutTimelineAt(doc, at, { templateOf }).items.filter((it) => isItemOfClip(it.id, clip.id));
    for (const t of truncatedTexts(items)) out.add(t);
  }
  return [...out];
}
