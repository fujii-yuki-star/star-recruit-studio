// 範囲を削除して、必要なら**間を詰める**（#1193・ADR-0034 決定11 の「間を詰める」を実装する）。
//
// ⚠️ **押しのけ（ripple）モードではない**＝「クリップを動かすたびに後ろが連鎖的に動く」形は
// **採らないまま**（ADR-0034 決定11）。ここで足すのは**押したときだけ動く1つの操作**で、
// `11 §8` V24（同一列で時間の重なり禁止）とも喧嘩しない。
//
// ⚠️ **1操作＝1つの取り消し**（ADR-0034 決定20）＝消すのと詰めるのを別々の履歴にしない。
// だからこの関数は**丸ごと1つの文書**を返す（呼ぶ側が2回に分けて積まない）。
//
// ⚠️ **切り方は `splitClip` に任せる**（写しを作らない）＝キーフレーム・音量の点・フェード・
// 素材の使い始めの扱いは**分けるのと同じ**でなければならない（同じ概念を同じ挙動に＝ADR-0026②）。

import { TIMELINE_MIN_CLIP_SEC } from '../constants';
import type { Template } from '../template/types';
import { isUnsplittableClipKind } from './clipKind';
import { EDIT_BLOCKED, removeClips, type EditBlockedReason } from './edit';
import { splitClip } from './split';
import type { TimelineClip, TimelineProject } from './types';

/** 音量の点を読む道具（`splitClip` がそのまま使う）。 */
type VolumeAt = (
  points: readonly { timeSec: number; volume: number }[] | undefined,
  localSec: number,
) => number | undefined;

/** 何をどうするか。 */
export type DeleteRangeInput = {
  startSec: number;
  endSec: number;
  /**
   * どの列を対象にするか（省略＝すべて）。
   *
   * ⚠️ **詰めるときは指定できない**＝列を選んで詰めると、ほかの列と**時間がずれ**、
   * 詰めて前へ来た部品が**ほかの列の中身と重なる**（V24）。下の `deleteRangeIssue` が断る。
   */
  trackIds?: readonly string[];
  /** 消したあとの空白を閉じるか。 */
  closeGap: boolean;
};

export type DeleteRangeResult =
  | {
      ok: true;
      doc: TimelineProject;
      /** 丸ごと消えた部品の数（切って短くなっただけのものは数えない）。 */
      removedClipCount: number;
      /**
       * 消した範囲の中にあって、**切れ目へ寄せた**目印の数。
       *
       * ⚠️ **黙って消さない**＝利用者が書いた覚えを勝手に捨てないので、寄せて数を返す
       *（呼ぶ側が知らせる＝§2-5）。
       */
      clampedMarkerCount: number;
    }
  | { ok: false; reason: EditBlockedReason };

/**
 * 断る理由（押す前に見る）。
 *
 * ⚠️ **固定された列があれば断る**＝まとめて消す・まとめて動かすと同じ扱い（`lockedSelection`）。
 * ⚠️ **詰めるときは全部の列が対象**＝一部だけ詰められない理由は上の `trackIds` に書いた。
 */
export function deleteRangeIssue(
  doc: TimelineProject,
  input: DeleteRangeInput,
): EditBlockedReason | null {
  if (!(input.endSec > input.startSec)) return EDIT_BLOCKED.notFound;
  const scope = targetTrackIds(doc, input);
  if (scope.length === 0) return EDIT_BLOCKED.notFound;
  const locked = new Set(doc.tracks.filter((t) => t.locked).map((t) => t.id));
  // ⚠️ **固定された列が対象にあれば断る**＝まとめて消す・まとめて動かすと同じ扱い。
  // ⚠️ **詰めるときは対象が全列になる**（`targetTrackIds`）ので、この1行で
  // 「固定したのに中身が動いた」も防げる＝**専用の判定は要らない**（変異チェックで等価と分かった）。
  if (scope.some((id) => locked.has(id))) return EDIT_BLOCKED.lockedSelection;
  if (overlapping(doc, scope, input).length === 0 && !input.closeGap) {
    // ⚠️ **何も掛かっていなければ断る**＝押しても何も起きない、を作らない（§2-5）。
    // ⚠️ **詰めるときは断らない**＝**空白そのものを詰める**のが目的なので、部品が無いのが正常。
    return EDIT_BLOCKED.notFound;
  }
  return null;
}

/** 対象の列（`trackIds` 省略／詰めるとき＝すべて）。 */
function targetTrackIds(doc: TimelineProject, input: DeleteRangeInput): string[] {
  if (input.closeGap || !input.trackIds) return doc.tracks.map((t) => t.id);
  return doc.tracks.filter((t) => input.trackIds?.includes(t.id)).map((t) => t.id);
}

/** 範囲に掛かっている部品（端がぴったり接するだけのものは含めない）。 */
function overlapping(
  doc: TimelineProject,
  scope: readonly string[],
  input: DeleteRangeInput,
): TimelineClip[] {
  const inScope = new Set(scope);
  return doc.clips.filter(
    (c) =>
      inScope.has(c.trackId) &&
      c.startSec < input.endSec &&
      c.startSec + c.durationSec > input.startSec,
  );
}

/**
 * 範囲を削除する（必要なら詰める）。
 *
 * ⚠️ **読み上げと、それに連動する字幕は丸ごと消す**＝**切れない**（`splitClipIssue` が断る）ので、
 * 半分だけ残すと**言いかけの声**になる。⚠️ **字幕だけ残さない**＝読み上げを消したのに字幕が残ると
 * 参照切れの帯になる（`removeClips` が持ち主を消しても、字幕は自分の `voiceClipId` を抱えたまま）。
 * ⚠️ **残りが短すぎる側は残さない**＝部品には最小の長さ（`TIMELINE_MIN_CLIP_SEC`）があるので、
 * それ未満の切れ端は**そもそも置けない**。黙って捨てずに、この注記で意図を残す。
 */
export function deleteRange(
  doc: TimelineProject,
  input: DeleteRangeInput,
  volumeAt: VolumeAt,
  opts: { templateOf?: (templateId: string) => Template | undefined } = {},
): DeleteRangeResult {
  const issue = deleteRangeIssue(doc, input);
  if (issue) return { ok: false, reason: issue };
  const scope = targetTrackIds(doc, input);
  const { startSec, endSec } = input;

  let next = doc;
  const removeIds: string[] = [];
  for (const clip of overlapping(doc, scope, input)) {
    const cs = clip.startSec;
    const ce = cs + clip.durationSec;
    const keepHead = startSec - cs >= TIMELINE_MIN_CLIP_SEC;
    const keepTail = ce - endSec >= TIMELINE_MIN_CLIP_SEC;
    if (isUnsplittableClipKind(clip) || (!keepHead && !keepTail)) {
      removeIds.push(clip.id);
      continue;
    }
    // ⚠️ **後ろから切る**＝先に前を切ると、後半の id が入れ替わって次の切り口を見失う。
    if (keepTail) {
      const cut = splitClip(next, clip.id, endSec, volumeAt, opts);
      if (!cut.ok) return { ok: false, reason: EDIT_BLOCKED.overlap };
      next = cut.doc;
    }
    if (keepHead) {
      const cut = splitClip(next, clip.id, startSec, volumeAt, opts);
      if (!cut.ok) return { ok: false, reason: EDIT_BLOCKED.overlap };
      next = cut.doc;
      removeIds.push(cut.newClipId); // 真ん中（範囲の中）を捨てる
    } else {
      removeIds.push(clip.id); // 前が残らない＝範囲の中だけになった
    }
  }
  next = removeClips(next, removeIds);
  if (!input.closeGap) {
    return { ok: true, doc: next, removedClipCount: removeIds.length, clampedMarkerCount: 0 };
  }
  const gap = endSec - startSec;
  const moved = shiftAfter(next, endSec, gap, startSec);
  return {
    ok: true,
    doc: moved.doc,
    removedClipCount: removeIds.length,
    clampedMarkerCount: moved.clampedMarkerCount,
  };
}

/**
 * `from` より後ろを `gap` だけ前へ寄せる（目印も一緒に）。
 *
 * ⚠️ **目印も動かす**（#1193 の設計）＝いま `markers.ts` には「時間の増減には付いて回らない」と
 * 書いてあるが、それは**尺が変わらない**前提の話。詰めると尺が縮むので、動かさないと
 * **既にある目印が全部、別の場面を指す**（黙って別の結果にしない＝ADR-0026④）。
 * ⚠️ **消した範囲の中にいた目印は、切れ目へ寄せる**＝指していた中身が無くなったので戻せない。
 * **黙って消さない**（利用者が書いた覚えを捨てない）＝寄せた数を返し、呼ぶ側が知らせる。
 */
function shiftAfter(
  doc: TimelineProject,
  from: number,
  gap: number,
  cutSec: number,
): { doc: TimelineProject; clampedMarkerCount: number } {
  const clips = doc.clips.map((c) =>
    c.startSec >= from ? { ...c, startSec: Math.max(0, c.startSec - gap) } : c,
  );
  let clamped = 0;
  const markers = (doc.markers ?? []).map((m) => {
    if (m.timeSec >= from) return { ...m, timeSec: Math.max(0, m.timeSec - gap) };
    if (m.timeSec > cutSec) {
      clamped += 1;
      return { ...m, timeSec: cutSec };
    }
    return m;
  });
  const next: TimelineProject = { ...doc, clips };
  if (markers.length > 0) next.markers = markers;
  return { doc: next, clampedMarkerCount: clamped };
}
