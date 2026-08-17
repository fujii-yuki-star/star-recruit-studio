// 帯を運ぶ・端を縮めるときの**吸着**（#686 段階4・ADR-0034 決定12）。
//
// 吸着先は**他の帯の端・再生位置・0秒**。**画面内に見えているものだけ**（見えていない所へ吸い付くと
// 「なぜ止まったか」が分からない）＝どこまでが見えているかは画面が決め、ここへは候補として渡す。
//
// ⚠️ **空間の吸着（`freeSnap`）とは別物**。あちらは左右と上下の2軸で、辺と中心に寄せる。
// こちらは時間の1軸で、寄せ先の意味も違う（再生位置・0秒）。**しきい値だけは同じものを見る**
// ＝指の感覚を画面ごとに変えない。
import { SNAP_THRESHOLD_PX } from '../project/freeSnap';

export { SNAP_THRESHOLD_PX };

/** 吸着先の種類。画面はこれで線の見せ方を変えられる（いまはどれも同じ縦の点線）。 */
export const TIME_SNAP_KIND = {
  /** 他の帯の端（開始・終わり）。 */
  clipEdge: 'clipEdge',
  /** 再生位置。 */
  playhead: 'playhead',
  /** 0秒（動画の先頭）。 */
  origin: 'origin',
} as const;
export type TimeSnapKind = (typeof TIME_SNAP_KIND)[keyof typeof TIME_SNAP_KIND];

export interface TimeSnapTarget {
  sec: number;
  kind: TimeSnapKind;
}

export interface TimeSnapResult {
  /** 動かす量に足す補正（秒）。吸着しなければ 0。 */
  deltaSec: number;
  /** 吸着した先（縦の点線を出す位置）。吸着しなければ `null`。 */
  guide: TimeSnapTarget | null;
}

/**
 * **いちばん近い1つ**へ寄せる（#686 段階4）。
 *
 * `edges` は動かしている帯の端（運ぶときは開始と終わりの両方・端を縮めるときはその端だけ）。
 * どの端がどの先に寄るかの組み合わせを全部見て、**距離がいちばん小さいもの**を選ぶ。
 * 同じ距離なら**先に渡された候補**を採る（画面が並べた優先順＝入力の順で決まる・偶然に任せない）。
 *
 * ⚠️ **`0` を返すのと「吸着しなかった」を混ぜない**＝ちょうど重なっているときも `guide` は返す
 * （線が出ないと「吸着したから止まった」のか「たまたま揃った」のか区別できない）。
 */
export function snapTime(input: {
  edges: readonly number[];
  targets: readonly TimeSnapTarget[];
  /** この距離（秒）まで寄る。画面は px のしきい値を倍率で割って渡す。 */
  thresholdSec: number;
}): TimeSnapResult {
  if (input.thresholdSec <= 0) return { deltaSec: 0, guide: null };
  let best: { delta: number; dist: number; target: TimeSnapTarget } | null = null;
  for (const t of input.targets) {
    for (const e of input.edges) {
      const delta = t.sec - e;
      const dist = Math.abs(delta);
      if (dist > input.thresholdSec) continue;
      if (!best || dist < best.dist) best = { delta, dist, target: t };
    }
  }
  return best ? { deltaSec: best.delta, guide: best.target } : { deltaSec: 0, guide: null };
}

/**
 * 吸着先を集める（#686 段階4）。**自分自身は入れない**（自分の端に吸い付いても動かない）。
 * **見えている時間帯の中だけ**＝画面の外の帯へ吸い付いて「なぜ止まったか」が分からない、を作らない。
 *
 * 並びは**近さで選ぶときの同点の順**になるので、意味の強いものから並べる
 * ＝再生位置 → 0秒 → 他の帯の端（利用者が「そこへ合わせたい」と思う順）。
 */
export function timeSnapTargets(input: {
  clips: readonly { id: string; startSec: number; durationSec: number }[];
  /** 除く部品（動かしている本人）。**新しく置くときは無い**ので省略できる（#771(a)）。 */
  exceptId?: string;
  playheadSec: number;
  visible: { fromSec: number; toSec: number };
}): TimeSnapTarget[] {
  const seen = new Set<number>();
  const out: TimeSnapTarget[] = [];
  const push = (sec: number, kind: TimeSnapKind): void => {
    if (sec < input.visible.fromSec || sec > input.visible.toSec) return;
    if (seen.has(sec)) return; // 同じ時刻を二重に持たない（同点の判定が入力順に揺れる）
    seen.add(sec);
    out.push({ sec, kind });
  };
  push(input.playheadSec, TIME_SNAP_KIND.playhead);
  push(0, TIME_SNAP_KIND.origin);
  for (const c of input.clips) {
    if (c.id === input.exceptId) continue;
    push(c.startSec, TIME_SNAP_KIND.clipEdge);
    push(c.startSec + c.durationSec, TIME_SNAP_KIND.clipEdge);
  }
  return out;
}

/**
 * **いま見えている時間帯**（#686 段階4）。吸着先をここに絞る＝見えていない所へ吸い付いて
 * 「なぜ止まったか」が読めない、を作らない。
 *
 * ⚠️ **左端は送った量そのもの**。時刻 t の位置は「列の名前の欄 + t×倍率」なので、
 * 欄の幅を引くと**欄の裏に隠れているぶん**（低倍率なら10秒超）まで入ってしまい、
 * 見えない時刻に線が出る。**右端は欄が中身を隠すぶんを引く**（欄は左に貼り付いている）。
 */
export function visibleTimeRange(input: {
  scrollLeft: number;
  clientWidth: number;
  labelPx: number;
  pxPerSec: number;
}): { fromSec: number; toSec: number } {
  if (input.pxPerSec <= 0) return { fromSec: 0, toSec: 0 };
  const fromSec = Math.max(0, input.scrollLeft / input.pxPerSec);
  const toSec = (input.scrollLeft + input.clientWidth - input.labelPx) / input.pxPerSec;
  return { fromSec, toSec: Math.max(fromSec, toSec) };
}
