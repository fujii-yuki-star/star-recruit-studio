// 時間の一点に置く**目印**（#356 ①）。
//
// ⚠️ **動画には出ない**＝描画にも書き出しにも現れない**作業用**のメモ。
// 「ここ直す」「ここに効果音」「この間を伸ばす」を編集しながら書き留めるためのもの。
// 門番＝`src/test/markersNotInVideoGuard.test.ts`（描く側・焼く側が目印を読んでいないことを見る）。
//
// ⚠️ **トラックには属さない**＝時間だけを持つ。だから
// **列を消しても・帯を動かしても、目印はそこに残る**（付いて回らない）。
// これは意図＝目印は「この時刻でこうしたい」という**作業の覚え**であって、部品の属性ではない。
//
// ⚠️ **時間の増減には付いて回らない**＝押しのけ（ripple）を採らない（ADR-0034 決定11）ので、
// 帯を動かしても全体の尺は動かない。目印が指す時刻の意味が変わることは無い。
import { createMarkerId } from '../project/persistence';
import type { TimelineMarker, TimelineProject } from './types';

/** メモの長さの上限（schema と同じ＝写しではなく、ここが画面へ配る単一の参照元）。 */
export const MARKER_TEXT_MAX = 200;

/** 目印を時刻順に並べる（同じ時刻なら足した順＝id 順）。 */
export function markersInOrder(doc: TimelineProject): TimelineMarker[] {
  return [...(doc.markers ?? [])].sort((a, b) => (a.timeSec - b.timeSec) || a.id.localeCompare(b.id));
}

/**
 * その時刻に**もう目印があるか**（同じ所に重ねない）。
 *
 * ⚠️ **同じ時刻に2つ置けると、どちらを直しているか分からなくなる**（一覧でも重なって見える）。
 * 押す前にこれを見て、あるなら**その目印を選ぶ**側へ倒す（増やさない）。
 */
export function markerAt(doc: TimelineProject, timeSec: number): TimelineMarker | undefined {
  return (doc.markers ?? []).find((m) => m.timeSec === timeSec);
}

/**
 * 再生位置に目印を置く。
 *
 * ⚠️ **同じ時刻に既にあれば足さない**＝その目印を返す（呼ぶ側はそれを選べばよい）。
 */
export function addMarker(doc: TimelineProject, timeSec: number): { doc: TimelineProject; markerId: string } {
  const already = markerAt(doc, timeSec);
  if (already) return { doc, markerId: already.id };
  const id = createMarkerId((doc.markers ?? []).map((m) => m.id));
  return { doc: { ...doc, markers: [...(doc.markers ?? []), { id, timeSec }] }, markerId: id };
}

/**
 * 目印のメモを書き換える。
 *
 * ⚠️ **上限で切る**＝schema の `maxLength` を超えると**保存はできて次に開けない**（#974 の型）。
 * 断るのではなく収める（打っている最中に赤くしない）。
 */
export function setMarkerText(doc: TimelineProject, markerId: string, text: string): TimelineProject {
  const markers = (doc.markers ?? []).map((m) => (m.id === markerId ? { ...m, text: text.slice(0, MARKER_TEXT_MAX) } : m));
  return { ...doc, markers };
}

/** 目印を消す。 */
export function removeMarker(doc: TimelineProject, markerId: string): TimelineProject {
  return { ...doc, markers: (doc.markers ?? []).filter((m) => m.id !== markerId) };
}

/**
 * 目印を動かす（時刻を変える）。
 *
 * ⚠️ **0 より前へは動かさない**＝schema が 0 以上しか許さないので、負にすると
 * **保存はできて次に開けない**。⚠️ **同じ時刻へは重ねない**（`addMarker` と同じ規則）。
 */
export function moveMarker(doc: TimelineProject, markerId: string, timeSec: number): TimelineProject {
  const at = Math.max(0, timeSec);
  const clash = (doc.markers ?? []).find((m) => m.id !== markerId && m.timeSec === at);
  if (clash) return doc;
  return { ...doc, markers: (doc.markers ?? []).map((m) => (m.id === markerId ? { ...m, timeSec: at } : m)) };
}
