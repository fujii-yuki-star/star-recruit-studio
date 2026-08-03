// 音量の変化（#512 段4）の編集＝**点を置く・直す・外す**だけ。純粋関数（副作用なし・§7 テスト対象）。
//
// **補間の規則はここに書かない**（`volumeAt` / `volumeExpr` が持つ＝§6）。キーフレームの編集
// （`keyframeEdit.ts`）と同じ流儀にそろえる＝時刻は**部品の先頭からの秒**・**同じ時刻には1つ**・
// **空の入れ物は残さない**・**固定した列の部品は変えられない**。
//
// 保存するのは**正規化した後**の点列（`normalizedVolumePoints`＝並び・重複・値域）。読むときも同じ
// 正規化を通るので、保存の形と読んだ形が食い違わない。
import { VOLUME_POINTS_MAX } from '../constants';
import { isAudioClip, normalizedVolumePoints } from './audio';
import { EDIT_BLOCKED } from './edit';
import type { EditResult } from './edit';
import type { TimelineClip, TimelineProject, VolumePoint } from './types';

/** 編集の前提（部品がある・音を持つ・固定されていない）を1か所で見る。 */
function target(doc: TimelineProject, clipId: string): TimelineClip | { reason: EditResult & { ok: false } } {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return { reason: { ok: false, reason: EDIT_BLOCKED.notFound } };
  // 「鳴る音を持つ部品か」は再生・書き出しと同じ述語で見る（§6＝判定を写さない）。
  if (!isAudioClip(clip)) return { reason: { ok: false, reason: EDIT_BLOCKED.volumePointsKind } };
  const locked = doc.tracks.some((t) => t.id === clip.trackId && t.locked);
  if (locked) return { reason: { ok: false, reason: EDIT_BLOCKED.locked } };
  return clip;
}

function isBlocked(v: ReturnType<typeof target>): v is { reason: EditResult & { ok: false } } {
  return 'reason' in v;
}

/**
 * 指定時刻に音量の点を**置く／直す**。
 *
 * - 時刻は**部品の先頭からの秒**。範囲（0〜部品の長さ）へ収める＝鳴らない位置に置かない。
 * - **同じ時刻には1つ**（すでにあれば値を差し替える＝点の数は増えない）。
 * - **置ける数には上限がある**（`VOLUME_POINTS_MAX`）＝**書き出せる範囲でしか置かせない**
 *   （置けたのに書き出しで断られる、を作らない・`11 §7.6.5`）。上限に達していたら**置かずに理由を返す**。
 * - 音量は保存できる範囲（0〜1.5）へ収める＝schema を通らない文書を作らない。
 */
export function setVolumePoint(doc: TimelineProject, clipId: string, timeSec: number, volume: number): EditResult {
  const t = target(doc, clipId);
  if (isBlocked(t)) return t.reason;
  const at = Math.min(Math.max(0, timeSec), t.durationSec);
  const before = normalizedVolumePoints(t.volumePoints);
  const points = normalizedVolumePoints([...before.filter((p) => p.timeSec !== at), { timeSec: at, volume }]);
  if (points.length > VOLUME_POINTS_MAX) return { ok: false, reason: EDIT_BLOCKED.volumePointsFull };
  return withPoints(doc, t, before, points);
}

/** 指定時刻の点を外す（無ければ何も変えない）。 */
export function removeVolumePoint(doc: TimelineProject, clipId: string, timeSec: number): EditResult {
  const t = target(doc, clipId);
  if (isBlocked(t)) return t.reason;
  const before = normalizedVolumePoints(t.volumePoints);
  return withPoints(doc, t, before, before.filter((p) => p.timeSec !== timeSec));
}

/** その部品の音量の変化をすべて外す（点を1つずつ消させない＝一定の音量へ戻る）。 */
export function clearVolumePoints(doc: TimelineProject, clipId: string): EditResult {
  const t = target(doc, clipId);
  if (isBlocked(t)) return t.reason;
  return withPoints(doc, t, normalizedVolumePoints(t.volumePoints), []);
}

/**
 * 点列を差し替えた文書。**点が無くなったらキーごと落とす**（空配列を保存に残さない＝「変化なし」と
 * 同じ形にそろえる）。**何も変わらないなら同じ参照を返す**＝取り消しが空振りする履歴を積ませない
 * （`edit.ts` / `keyframeEdit.ts` と同じ流儀）。
 */
function withPoints(
  doc: TimelineProject,
  clip: TimelineClip,
  before: readonly VolumePoint[],
  points: VolumePoint[],
): EditResult {
  if (samePoints(before, points)) return { ok: true, doc };
  const next: TimelineClip = { ...clip };
  if (points.length === 0) delete next.volumePoints;
  else next.volumePoints = points;
  return { ok: true, doc: { ...doc, clips: doc.clips.map((c) => (c.id === clip.id ? next : c)) } };
}

function samePoints(a: readonly VolumePoint[], b: readonly VolumePoint[]): boolean {
  return a.length === b.length && a.every((p, i) => p.timeSec === b[i].timeSec && p.volume === b[i].volume);
}

/**
 * 再生位置（動画の時刻）を、その部品に置ける「先頭からの秒」へ直す。置けない位置なら `null`。
 *
 * **終わりちょうども置ける**（区間は**閉じている**）＝`setVolumePoint` が受け付ける範囲（0〜部品の長さ）と
 * 同じ規則を、画面と1か所で共有するための関数（§6）。
 *
 * ⚠️ **描画の生存判定（`clipIsLiveAt`＝半開 `[開始, 終了)`）を流用してはいけない**。あれは「その瞬間に
 * 鳴っている／映っているか」で、終端は次の部品のものだから外す。音量の点は**その時刻の値**であって、
 * 終端は「ここまでにこの音量へ到達する」という到達点＝**外すと「だんだん大きく」の行き先が置けない**
 * （#512 の実機確認で判明）。
 */
export function volumePointTimeAt(clip: TimelineClip, timeSec: number): number | null {
  const local = timeSec - clip.startSec;
  return local >= 0 && local <= clip.durationSec ? local : null;
}
