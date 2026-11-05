// 部品を id で引く（純粋・副作用は作り置きだけ）。
//
// ⚠️ **部品の数の2乗にしない**（負荷試験 2026-10-22）＝字幕ごとに連動先の読み上げを `doc.clips.find` で探していたので、
// 字幕 344・部品 2216 の動画では**1コマ描くたびに約76万回**比べていた（再生が 15fps に落ちた原因の1つ）。
// 文書は編集のたびに新しい部品の配列になる（取り消しの履歴と同じ＝ADR-0020）ので、**配列ごとに**索引を作り置く。
//
// ⚠️ **作り置きを信じきらない**＝検査などで配列をその場で書き換えても古い部品を返さないよう、
// 索引は「id → 何番目か」だけを持ち、引くたびにその番目の部品の id を確かめる（違えば作り直す）。
// 返すのは**いまその番目にある部品**（作り置いた物ではない）。
import type { TimelineClip } from './types';

interface ClipIndex {
  map: Map<string, number>;
  /** 作ったときの数＝見つからないとき、作り置きが古いのか本当に無いのかを見分ける。 */
  length: number;
}

const indexOf = new WeakMap<readonly TimelineClip[], ClipIndex>();

function build(clips: readonly TimelineClip[]): ClipIndex {
  const map = new Map<string, number>();
  // 同じ id が2つあれば先のもの＝`Array.prototype.find` と同じ答え。
  clips.forEach((c, i) => { if (!map.has(c.id)) map.set(c.id, i); });
  const index = { map, length: clips.length };
  indexOf.set(clips, index);
  return index;
}

/** `clips.find((c) => c.id === id)` と同じ答えを、部品の数によらずほぼ一定の手間で返す。 */
export function findClipById(clips: readonly TimelineClip[], id: string): TimelineClip | undefined {
  const cached = indexOf.get(clips);
  const index = cached ?? build(clips);
  const i = index.map.get(id);
  if (i !== undefined && clips[i]?.id === id) return clips[i];
  // ⚠️ **見つからないのが本当か**＝いま作った索引か、作ったときと数が同じなら本当に無いとみなす
  //   （指している先が無い字幕は毎コマ引かれる＝そのたびに作り直すと、また部品の数ぶんかかる）。
  //   数を変えずに別の id の部品へ差し替えた場合だけは見落とすが、文書は差し替えのたびに新しい配列になる。
  if (i === undefined && (cached === undefined || cached.length === clips.length)) return undefined;
  // 作り置きと食い違う（その場で書き換えられた）＝作り直して引き直す。
  const fresh = build(clips);
  const j = fresh.map.get(id);
  return j === undefined ? undefined : clips[j];
}
