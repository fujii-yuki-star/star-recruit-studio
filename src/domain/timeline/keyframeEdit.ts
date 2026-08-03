// キーフレームの編集（ADR-0032 決定3 の「中位」・#634）。純粋関数（副作用なし・§7 テスト対象）。
//
// **器はすでに描画側にある**（`ClipAnimation` ＋ `interpolateKeyframes`）＝プレビューと書き出しは同じ
// 補間を通る（ADR-0001）。ここが足すのは「置く・直す・外す」だけで、**補間の規則は書かない**（§6）。
//
// 時刻は**クリップの先頭からの秒**（`Keyframe.timeSec`）。グループを対象にしたときの起点は
// **所属クリップのうち最も早い開始秒**（`11 §7.6`＝描画と同じ）。
//
// **値は「本来の見た目からのずれ」**（絶対値ではない・`domain/project/keyframes.ts`）＝
// x/y は箱の位置に**足す**px、`scale` は**倍率**（1＝そのまま）、`rotation` は**足す**度、
// `opacity` は**クリップ全体に掛かる濃さ**（1＝そのまま）。ここを絶対値と取り違えると、
// 「いまの見た目を覚える」つもりの操作で絵が飛ぶ（#634 レビュー 🔴）。
import { GROUP_MIN_SCALE } from '../constants';
import type { EasingSpec } from '../enums';
import { groupElementIds } from '../project/groupOps';
import { createAnimationId } from '../project/persistence';
import type { Keyframe } from '../project/types';
import { EDIT_BLOCKED } from './edit';
import type { EditResult } from './edit';
import type { ClipAnimation, TimelineProject } from './types';

/** キーフレームで動かせるプロパティ（`Keyframe` の可変分＝`interpolateKeyframes` の対象）。 */
export const KEYFRAME_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;
export type KeyframeProp = (typeof KEYFRAME_PROPS)[number];

/** 置く／直す値（渡したプロパティだけを触る＝`null` で「このプロパティは動かさない」に戻す）。 */
export type KeyframeInput = Partial<Record<KeyframeProp, number | null>> & { easing?: EasingSpec };

/** 対象（クリップまたはグループ）の動きが始まる秒＝時刻の起点（描画と同じ規則）。 */
export function animationOriginSec(doc: TimelineProject, targetId: string): number | undefined {
  const clip = doc.clips.find((c) => c.id === targetId);
  if (clip) return clip.startSec;
  const group = (doc.groups ?? []).find((g) => g.id === targetId);
  if (!group) return undefined;
  const memberStarts = groupElementIds(doc.groups ?? [], targetId)
    .map((id) => doc.clips.find((c) => c.id === id)?.startSec)
    .filter((v): v is number => v != null);
  return memberStarts.length > 0 ? Math.min(...memberStarts) : undefined;
}

/** 対象の動きが続く長さ（秒）＝キーフレームを置ける範囲の終わり。 */
function spanSec(doc: TimelineProject, targetId: string): number | undefined {
  const clip = doc.clips.find((c) => c.id === targetId);
  if (clip) return clip.durationSec;
  const origin = animationOriginSec(doc, targetId);
  if (origin == null) return undefined;
  const ends = groupElementIds(doc.groups ?? [], targetId)
    .map((id) => doc.clips.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => c != null)
    .map((c) => c.startSec + c.durationSec);
  return ends.length > 0 ? Math.max(...ends) - origin : undefined;
}

/**
 * 再生位置（動画の時刻）を、その対象に置ける「先頭からの秒」へ直す。置けない位置なら `null`。
 *
 * **終わりちょうども置ける**（区間は**閉じている**）＝`setKeyframe` のクランプ範囲（0〜対象の長さ）と
 * 同じ規則を画面と1か所で共有する（§6）。**描画の生存判定（`clipIsLiveAt`＝半開）を流用してはいけない**＝
 * 終端に置けず「ここまでに動き終わる」到達点が作れない（音量の変化で同じ誤りをしていた・#512 実機確認）。
 * グループを対象にしたときの起点・長さは `animationOriginSec`／所属クリップの最後の終わりで見る
 * （クリップ1つとは範囲が違う）。
 *
 * 端は**丸めの都合で外れない**ように見て、返す秒は範囲へ収めたうえでマイクロ秒で丸める
 * （`volumePointTimeAt` と同じ理由＝置き直しのつもりで点が増えない）。
 */
export function keyframeTimeAt(doc: TimelineProject, targetId: string, timeSec: number): number | null {
  const origin = animationOriginSec(doc, targetId);
  const span = spanSec(doc, targetId);
  if (origin == null || span == null) return null;
  if (timeSec < origin || timeSec > origin + span) return null;
  return Math.round(Math.min(Math.max(0, timeSec - origin), span) * 1e6) / 1e6;
}

/** その対象が固定された列に乗っているか（グループはメンバーのどれかが固定なら固定扱い）。 */
function isLocked(doc: TimelineProject, targetId: string): boolean {
  const lockedTracks = new Set(doc.tracks.filter((t) => t.locked).map((t) => t.id));
  const clip = doc.clips.find((c) => c.id === targetId);
  if (clip) return lockedTracks.has(clip.trackId);
  return groupElementIds(doc.groups ?? [], targetId).some((id) => {
    const c = doc.clips.find((x) => x.id === id);
    return c != null && lockedTracks.has(c.trackId);
  });
}

/**
 * 値を「そのプロパティとして意味のある範囲」へ収める。
 *
 * - `opacity` は 0〜1（描画・schema と同じ）。
 * - `scale` は **0 より大きい**（schema は `exclusiveMinimum: 0`＝0 を書くと**保存できない文書**になる）。
 *   下限は要素の拡大率と同じ `GROUP_MIN_SCALE`（§2-7）。
 * - `rotation` は**丸めない**＝値は「足す度」なので負や 360 以上に意味がある（逆回転・複数回転。
 *   正典の動きプリセットも `-180` を使う）。schema にも上下限は無い。
 */
function clampProp(prop: KeyframeProp, v: number): number {
  if (prop === 'opacity') return Math.min(Math.max(0, v), 1);
  if (prop === 'scale') return Math.max(GROUP_MIN_SCALE, v);
  return v;
}

/**
 * 対象（クリップ／グループ）の指定時刻へキーフレームを**置く／直す**。
 *
 * - 時刻は**対象の先頭からの秒**。範囲（0〜対象の長さ）へ収める＝動画に効かない位置に置かない。
 * - **同じ時刻には1つ**（すでにあれば渡したプロパティだけ差し替え）＝時刻が重なった2つのKFで
 *   補間が入力順に依存する、を作らない。
 * - `null` を渡したプロパティは**外す**（そのプロパティは動かさない）。プロパティが1つも残らない
 *   キーフレームは落とし、キーフレームが1つも残らない動きは**動き自体を落とす**（空の器を残さない）。
 * - 固定した列の部品は変えられない（`§7.6.3` と同じ扱い）。
 */
export function setKeyframe(
  doc: TimelineProject,
  targetId: string,
  timeSec: number,
  input: KeyframeInput,
): EditResult {
  const span = spanSec(doc, targetId);
  if (span == null) return { ok: false, reason: EDIT_BLOCKED.notFound };
  if (isLocked(doc, targetId)) return { ok: false, reason: EDIT_BLOCKED.locked };
  const at = Math.min(Math.max(0, timeSec), span);

  const anims = doc.animations ?? [];
  const existing = anims.find((a) => a.targetId === targetId);
  const before = existing?.keyframes ?? [];
  const current = before.find((k) => k.timeSec === at);
  const next: Keyframe = { ...current, timeSec: at };
  for (const prop of KEYFRAME_PROPS) {
    const v = input[prop];
    if (v === undefined) continue;
    if (v === null) delete next[prop];
    else next[prop] = clampProp(prop, v);
  }
  if (input.easing !== undefined) next.easing = clampEasing(input.easing);
  const hasProp = KEYFRAME_PROPS.some((p) => next[p] != null);

  const keyframes = [...before.filter((k) => k.timeSec !== at), ...(hasProp ? [next] : [])].sort(
    (a, b) => a.timeSec - b.timeSec,
  );
  // 何も変わらないなら文書をそのまま返す＝取り消しが空振りする履歴を積ませない（`edit.ts` と同じ流儀）。
  if (sameKeyframes(before, keyframes)) return { ok: true, doc };
  return { ok: true, doc: withAnimation(doc, targetId, keyframes, existing) };
}

/** 指定時刻のキーフレームを外す（無ければ何も変えない）。 */
export function removeKeyframe(doc: TimelineProject, targetId: string, timeSec: number): EditResult {
  if (spanSec(doc, targetId) == null) return { ok: false, reason: EDIT_BLOCKED.notFound };
  if (isLocked(doc, targetId)) return { ok: false, reason: EDIT_BLOCKED.locked };
  const existing = (doc.animations ?? []).find((a) => a.targetId === targetId);
  if (!existing || !existing.keyframes.some((k) => k.timeSec === timeSec)) return { ok: true, doc };
  const keyframes = existing.keyframes.filter((k) => k.timeSec !== timeSec);
  return { ok: true, doc: withAnimation(doc, targetId, keyframes, existing) };
}

/** その対象の動きをすべて外す（キーフレームを1つずつ消させない）。 */
export function clearKeyframes(doc: TimelineProject, targetId: string): EditResult {
  if (spanSec(doc, targetId) == null) return { ok: false, reason: EDIT_BLOCKED.notFound };
  if (isLocked(doc, targetId)) return { ok: false, reason: EDIT_BLOCKED.locked };
  const existing = (doc.animations ?? []).find((a) => a.targetId === targetId);
  if (!existing) return { ok: true, doc };
  return { ok: true, doc: withAnimation(doc, targetId, [], existing) };
}

/** キーフレーム列が同じ中身か（時刻・値・イージングまで）。 */
function sameKeyframes(a: readonly Keyframe[], b: readonly Keyframe[]): boolean {
  return a.length === b.length && a.every((k, i) => JSON.stringify(k) === JSON.stringify(b[i]));
}

/**
 * 動きを差し替えた文書。**キーフレームが無くなったら動き自体を落とす**（空の器を残さない＝
 * V26 の参照掃除と同じ流儀）。`animations` が空になったらキーごと落とす（保存に空配列を残さない）。
 */
function withAnimation(
  doc: TimelineProject,
  targetId: string,
  keyframes: Keyframe[],
  existing: ClipAnimation | undefined,
): TimelineProject {
  const others = (doc.animations ?? []).filter((a) => a.targetId !== targetId);
  const animations =
    keyframes.length === 0
      ? others
      : [
          ...others,
          {
            id: existing?.id ?? createAnimationId((doc.animations ?? []).map((a) => a.id)),
            targetId,
            keyframes,
          },
        ];
  const next = { ...doc };
  if (animations.length === 0) delete next.animations;
  else next.animations = animations;
  return next;
}

/**
 * 自由なカーブ（#262）の制御点を**保存できる範囲**へ収める。`x` は 0〜1（schema の制約＝時間が戻らない）。
 * `y` は**丸めない**＝範囲外に意味がある（行き過ぎて戻る動き）。名前つきはそのまま。
 */
function clampEasing(easing: EasingSpec): EasingSpec {
  if (typeof easing === 'string') return easing;
  const [x1, y1, x2, y2] = easing.bezier;
  const x = (v: number): number => Math.min(Math.max(0, v), 1);
  return { bezier: [x(x1), y1, x(x2), y2] };
}
