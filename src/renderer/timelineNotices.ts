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
 * 枠に入りきらず末尾が「…」になる文字（**切れる部品ごとに1つ**＝同じ文の部品が2つ切れていれば2つ）。
 *
 * ⚠️ **何か所かの時刻で見る**（PR #1369 レビュー 🟡）＝文字そのものは部品の間変わらないが、**大きさの動き**
 * （部品やまとまりの拡縮）は枠の幅だけを変える（字の大きさはそのまま＝`applySimilarity`）ので、
 * 時刻によって切れたり切れなかったりする。始まり・真ん中・終わりと、**部品自身のキーフレームの時刻**で見て、
 * どこかで切れれば挙げる（まとまりの動きの時刻までは見ない＝見逃しうる）。
 * 隠した列・部品・まとまりは描かれないので数えない（`layoutTimelineAt` がそもそも出さない）。
 */
export function timelineTruncatedTexts(
  doc: TimelineProject,
  templateOf: (templateId: string) => Template | undefined,
): string[] {
  const out: string[] = [];
  const frame = 1 / doc.videoSettings.fps;
  for (const clip of doc.clips) {
    if (!isVisualClip(clip)) continue;
    const end = clip.startSec + clip.durationSec;
    const own = (doc.animations ?? []).find((a) => a.targetId === clip.id)?.keyframes ?? [];
    const times = [clip.startSec, clip.startSec + clip.durationSec / 2, end - frame, ...own.map((k) => clip.startSec + k.timeSec)]
      .filter((t) => t >= clip.startSec && t < end);
    let found: string | undefined;
    for (const at of times) {
      const items = layoutTimelineAt(doc, at, { templateOf }).items.filter((it) => isItemOfClip(it.id, clip.id));
      found = truncatedTexts(items)[0];
      if (found != null) break;
    }
    if (found != null) out.push(found);
  }
  return out;
}
