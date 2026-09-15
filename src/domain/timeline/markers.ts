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

/**
 * メモの長さの上限（`11 §4` 定数カタログ）。
 *
 * ⚠️ **schema の `maxLength` の写し**（#1138 レビュー由来 🟡）＝以前ここに「写しではない」と
 * 書いていたが、参照も導出もしていない**ただの写し**だった（`CLAUDE.md §7`＝書いた主張は検査する）。
 * ⚠️ **危ない向きのずれは門番が捕まえる**＝ここが schema より**大きく**なると
 * 「保存はできて次に開けない」文書ができるが、`markers.test.ts` の
 * 「長すぎるメモは切る（開けない文書を作らない）」が**切った長さちょうどで schema に通す**ので赤くなる。
 */
export const MARKER_TEXT_MAX = 200;

/**
 * 目印の時刻の表示（**コマまで出す**）。
 *
 * ⚠️ **秒で丸めない**（#1138 レビュー由来 🟡）＝画面の `clockLabel` は秒に丸めるので、
 * `3.1秒` と `3.4秒` の目印が**どちらも「0:03」**になり、一覧で**見分けがつかない**
 *（重なりを防いでいるのはコマ単位の一致だけなので、この状態は普通に作れる）。
 * 業界の一覧もコマまで出す（`00:00:03:12`）。
 */
export function markerClock(timeSec: number, fps: number): string {
  const total = Math.max(0, timeSec);
  const mm = Math.floor(total / 60);
  const ss = Math.floor(total % 60);
  const ff = Math.round((total - Math.floor(total)) * fps);
  return `${mm}:${String(ss).padStart(2, '0')}.${String(ff).padStart(2, '0')}`;
}

/**
 * 同じ時刻とみなすか（丸めの差で「別の時刻」に化けさせない）。
 *
 * ⚠️ **完全一致で見ない**＝保存と再生位置はどちらもコマの格子へ落ちるが、浮動小数の差が残る。
 */
export function markerTimeEq(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

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
  // ⚠️ **同じ物差しで見る**（#1155 ②）＝`markerTimeEq` は「完全一致で見ない」と書いているのに、
  // ここは `===` だった。**注記が本当なら**丸めの差で同じコマに2つ置けてしまい、
  // この関数が防ぐと言っているもの（どちらを直しているか分からない）が作れる。
  // **注記が偽なら**注記が嘘。安全側＝`markerTimeEq` へ寄せる。
  return (doc.markers ?? []).find((m) => markerTimeEq(m.timeSec, timeSec));
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
  let changed = false;
  const markers = (doc.markers ?? []).map((m) => {
    if (m.id !== markerId) return m;
    const next = text.slice(0, MARKER_TEXT_MAX);
    // ⚠️ **空なら項目ごと落とす**（#1138 レビュー由来 ℹ️）＝正典は「**未指定＝位置だけの目印**」と
    // 言っているので、空文字を残すと**同じ状態に2通りの書き方**ができる（§2-7）。
    if (next === '') {
      if (m.text === undefined) return m;
      changed = true;
      const { text: _text, ...rest } = m;
      return rest;
    }
    if (m.text === next) return m;
    changed = true;
    return { ...m, text: next };
  });
  // ⚠️ **変わらなければ同じ文書を返す**（#1149 ②・ADR-0020／ADR-0034 決定20）＝呼ぶ側は
  // `if (next !== doc)` で空振りを弾く作りなので、ここで契約を破ると**何も変わらないのに履歴が積まれる**。
  // `Ctrl+Z` を押しても画面が変わらず、押し続けると**取り消しでしか戻せない編集が押し出される**。
  return changed ? { ...doc, markers } : doc;
}

/**
 * 目印を消す。
 *
 * ⚠️ **無ければ同じ文書を返す**（#1149 ②）＝`setMarkerText`／`moveMarker` と同じ契約。
 * 片方だけ直す形をこの repo で繰り返しているので、**3つとも同じ規則**にしてある。
 */
export function removeMarker(doc: TimelineProject, markerId: string): TimelineProject {
  const markers = (doc.markers ?? []).filter((m) => m.id !== markerId);
  return markers.length === (doc.markers ?? []).length ? doc : { ...doc, markers };
}

/**
 * 目印を**再生位置へ動かす**（時刻を変える）。
 *
 * ⚠️ **置けるのに直せない、を作らない**（ADR-0034 決定4・#1138 レビュー由来 🟡）＝
 * 業界では印はルーラー上で掴んで動かせる。ここでは**掴む操作を発明せず**、
 * 「再生位置へ動かす」＝この画面に既にある道具（再生位置）で直せる形にする。
 *
 * ⚠️ **0 より前へは動かさない**＝schema が 0 以上しか許さないので、負にすると
 * **保存はできて次に開けない**。⚠️ **同じ時刻へは重ねない**（`addMarker` と同じ規則）。
 */
export function moveMarker(doc: TimelineProject, markerId: string, timeSec: number): TimelineProject {
  const at = Math.max(0, timeSec);
  // ⚠️ **置くときと同じ物差し**（#1155 ②）＝片方だけ `===` だと、置けないのに動かせる（またはその逆）。
  const clash = (doc.markers ?? []).find((m) => m.id !== markerId && markerTimeEq(m.timeSec, at));
  if (clash) return doc;
  // ⚠️ **もうそこに居るなら同じ文書を返す**（#1149 ②）＝「置く → 一覧の時刻を押して再生位置を合わせる →
  // 再生位置へ動かす」は普通に踏む筋で、ここで新しい文書を返すと**何も変わらないのに履歴が積まれる**。
  const me = (doc.markers ?? []).find((m) => m.id === markerId);
  if (!me || markerTimeEq(me.timeSec, at)) return doc;
  return { ...doc, markers: (doc.markers ?? []).map((m) => (m.id === markerId ? { ...m, timeSec: at } : m)) };
}

/**
 * その目印を**そこへ動かせるか**（`null`＝動かせる）。
 *
 * ⚠️ **押す前に断るために切り出す**（#1149 ①）＝動かせないのに**押せる見た目のまま無反応**だと、
 * 「押しても何も起きない」を作る（§2-5）。呼ぶ側が理由を出せるよう、判定だけを外へ出す。
 */
export function moveMarkerBlocked(
  doc: TimelineProject,
  markerId: string,
  timeSec: number,
): 'markerExists' | null {
  const at = Math.max(0, timeSec);
  return (doc.markers ?? []).some((m) => m.id !== markerId && markerTimeEq(m.timeSec, at)) ? 'markerExists' : null;
}
