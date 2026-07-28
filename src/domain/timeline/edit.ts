// タイムライン形式（ADR-0032）の編集操作（#629）。純粋関数（副作用なし・§7 テスト対象）。
//
// **置けない操作は黙って別の結果にしない**（§2-5・ADR-0026④）＝重なる位置へ動かそうとしたら、勝手に
// 近くへ寄せたり上書きしたりせず「置けなかった理由」を返す。理由の文言は `15 §6`、出すのは呼び出し側。
import { TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import type { TimelineClipKind, TrackKind } from '../enums';
import { createClipId, createTrackId } from '../project/persistence';
import type { Group } from '../group/types';
import { clipEndSec } from './validateTimelineDoc';
import type { TimelineClip, TimelineProject, Track } from './types';

/** 置けなかった理由（`15 §6` の `TIMELINE_EDIT_*`）。永続データではないので schema には持ち込まない。 */
export const EDIT_BLOCKED = {
  /** 同じ列で時間が重なる（11 §8 V24）。重ねたいなら列を足す。 */
  overlap: 'TIMELINE_EDIT_OVERLAP',
  /** 音の部品を映像の列へ（逆も）＝置いても鳴らない/映らない（V23）。 */
  trackKind: 'TIMELINE_EDIT_TRACK_KIND',
  /** 列が固定されている（`track.locked`）。 */
  locked: 'TIMELINE_EDIT_LOCKED',
  /** 対象が見つからない（消された直後の操作など）。 */
  notFound: 'TIMELINE_EDIT_NOT_FOUND',
} as const;

export type EditBlockedReason = (typeof EDIT_BLOCKED)[keyof typeof EDIT_BLOCKED];

/** 編集の結果。**置けないときは文書を返さない**＝呼び出し側が「変わらなかった」と取り違えない。 */
export type EditResult = { ok: true; doc: TimelineProject } | { ok: false; reason: EditBlockedReason };

const ok = (doc: TimelineProject): EditResult => ({ ok: true, doc });
const blocked = (reason: EditBlockedReason): EditResult => ({ ok: false, reason });

/** クリップ種別を置ける列の種別（`validateTimelineDoc` の V23 と同じ規則＝判定を2か所に書かない）。 */
const TRACK_KIND_FOR_CLIP = {
  [TIMELINE_CLIP_KIND.slot]: TRACK_KIND.visual,
  [TIMELINE_CLIP_KIND.text]: TRACK_KIND.visual,
  [TIMELINE_CLIP_KIND.shape]: TRACK_KIND.visual,
  [TIMELINE_CLIP_KIND.subtitle]: TRACK_KIND.visual,
  [TIMELINE_CLIP_KIND.template]: TRACK_KIND.visual,
  [TIMELINE_CLIP_KIND.audio]: TRACK_KIND.audio,
  [TIMELINE_CLIP_KIND.voice]: TRACK_KIND.audio,
} as const satisfies Record<TimelineClipKind, TrackKind>;

/**
 * その列のその時間帯が空いているか（11 §8 V24）。**端が接するのは可**（前の終わり＝次の始まり）。
 * `exceptClipId` は自分自身を数えないため（動かす当人と重なると判定しない）。
 */
export function isFreeSpan(
  clips: readonly TimelineClip[],
  trackId: string,
  startSec: number,
  durationSec: number,
  exceptClipId?: string,
): boolean {
  const end = startSec + durationSec;
  return !clips.some(
    (c) => c.trackId === trackId && c.id !== exceptClipId && c.startSec < end && startSec < clipEndSec(c),
  );
}

/** 置き先として成り立つか（列の実在・種別の一致・固定・重なり）を1か所で見る。 */
function placementIssue(
  doc: TimelineProject,
  clip: TimelineClip,
  trackId: string,
  startSec: number,
  durationSec: number,
): EditBlockedReason | null {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track) return EDIT_BLOCKED.notFound;
  if (track.locked) return EDIT_BLOCKED.locked;
  if (track.kind !== TRACK_KIND_FOR_CLIP[clip.kind]) return EDIT_BLOCKED.trackKind;
  if (!isFreeSpan(doc.clips, trackId, startSec, durationSec, clip.id)) return EDIT_BLOCKED.overlap;
  return null;
}

/** クリップを差し替えた文書（他は素通し）。 */
function withClip(doc: TimelineProject, next: TimelineClip): TimelineProject {
  return { ...doc, clips: doc.clips.map((c) => (c.id === next.id ? next : c)) };
}

/**
 * クリップを動かす（列を替える／時間をずらす）。**開始は 0 より前に出さない**（時間の外へ置かない）。
 * 元の列が固定されているときも動かさない＝「固定」が見た目だけにならない（ADR-0026④）。
 */
export function moveClip(
  doc: TimelineProject,
  clipId: string,
  to: { trackId?: string; startSec?: number },
): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  const trackId = to.trackId ?? clip.trackId;
  const startSec = Math.max(0, to.startSec ?? clip.startSec);
  const issue = placementIssue(doc, clip, trackId, startSec, clip.durationSec);
  return issue ? blocked(issue) : ok(withClip(doc, { ...clip, trackId, startSec }));
}

/** トリムの最小の長さ（秒）。0 以下のクリップを作らない（schema の `durationSec > 0`）。 */
export const MIN_CLIP_DURATION_SEC = 0.1;

/**
 * クリップの端を動かす（トリム）。`edge='start'` は開始を、`'end'` は終わりを動かす。
 * **反対側の端は動かさない**＝片端を縮めるともう片端が付いてくる、を起こさない。
 * 短くしすぎは最小の長さで止める（0 以下や負の長さを作らない）。
 */
export function trimClip(doc: TimelineProject, clipId: string, edge: 'start' | 'end', sec: number): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  const end = clipEndSec(clip);
  const next =
    edge === 'start'
      ? (() => {
          const startSec = Math.max(0, Math.min(sec, end - MIN_CLIP_DURATION_SEC));
          return { ...clip, startSec, durationSec: end - startSec };
        })()
      : { ...clip, durationSec: Math.max(MIN_CLIP_DURATION_SEC, sec - clip.startSec) };
  const issue = placementIssue(doc, next, next.trackId, next.startSec, next.durationSec);
  return issue ? blocked(issue) : ok(withClip(doc, next));
}

/** グループのメンバーから消えた id を落とす（空になったグループも畳む＝中身の無い入れ物を残さない・V26）。 */
function pruneGroups(groups: readonly Group[], removed: ReadonlySet<string>): Group[] {
  const next = groups
    .map((g) => ({ ...g, members: g.members.filter((m) => !removed.has(m)) }))
    .filter((g) => g.members.length > 0);
  // グループ自身が消えたら、それを入れ子に持つ側からも落とす（1段ずつ収束させる）。
  const goneIds = new Set(groups.filter((g) => !next.some((n) => n.id === g.id)).map((g) => g.id));
  return goneIds.size === 0 ? next : pruneGroups(next, goneIds);
}

/**
 * クリップを消す。**参照も一緒に片づける**＝グループのメンバーとキーフレームの対象から落とす
 * （残すと「消したのに動きだけ残る」参照切れになる・11 §8 V26）。
 */
export function removeClips(doc: TimelineProject, clipIds: readonly string[]): TimelineProject {
  const removed = new Set(clipIds);
  const clips = doc.clips.filter((c) => !removed.has(c.id));
  const groups = pruneGroups(doc.groups ?? [], removed);
  const animations = (doc.animations ?? []).filter(
    (a) => !removed.has(a.targetId) && (groups.some((g) => g.id === a.targetId) || clips.some((c) => c.id === a.targetId)),
  );
  // **条件付きスプレッドでは消せない**（`...doc` が元の groups/animations を残すので、
  // 空になったときに古い値が生き残る）。無くなったキーは明示的に落とす。
  const next: TimelineProject = { ...doc, clips };
  if (groups.length > 0) next.groups = groups;
  else delete next.groups;
  if (animations.length > 0) next.animations = animations;
  else delete next.animations;
  return next;
}

/**
 * 列を足す。**いちばん手前（配列の末尾）に足す**＝足した列がすぐ見える（重ね順は配列の並びだけ・11 §7.6）。
 * 音の列は重ね順に関係しないが、同じ規則で末尾に足す（並びの意味を種別で変えない）。
 */
export function addTrack(doc: TimelineProject, kind: TrackKind): TimelineProject {
  const track: Track = { id: createTrackId(doc.tracks.map((t) => t.id)), kind };
  return { ...doc, tracks: [...doc.tracks, track] };
}

/**
 * 列を消す。**その列に載っているクリップも一緒に消える**（行き場が無くなるため）。
 * 何が消えるかは呼び出し側が数えて確認を出す＝黙って消さない（§2-5）。
 */
export function removeTrack(doc: TimelineProject, trackId: string): TimelineProject {
  const ids = doc.clips.filter((c) => c.trackId === trackId).map((c) => c.id);
  const withoutClips = removeClips(doc, ids);
  return { ...withoutClips, tracks: withoutClips.tracks.filter((t) => t.id !== trackId) };
}

/** その列に載っているクリップの数（列を消す前の確認に使う）。 */
export function clipCountOnTrack(doc: TimelineProject, trackId: string): number {
  return doc.clips.filter((c) => c.trackId === trackId).length;
}

/**
 * 列の重ね順を1つ動かす（`direction='front'` で手前＝配列の後ろへ）。端では何も起きない。
 * **重ね順は配列の並びだけで決まる**（11 §7.6）ので、並べ替えがそのまま前後関係になる。
 */
export function moveTrackOrder(doc: TimelineProject, trackId: string, direction: 'front' | 'back'): TimelineProject {
  const i = doc.tracks.findIndex((t) => t.id === trackId);
  const j = direction === 'front' ? i + 1 : i - 1;
  if (i < 0 || j < 0 || j >= doc.tracks.length) return doc;
  const tracks = [...doc.tracks];
  [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  return { ...doc, tracks };
}

/** 列の表示/非表示・固定を切り替える（描画・書き出しから外す／移動とトリムを禁じる）。 */
export function setTrackFlag(doc: TimelineProject, trackId: string, flag: 'hidden' | 'locked', value: boolean): TimelineProject {
  return {
    ...doc,
    tracks: doc.tracks.map((t) => (t.id === trackId ? { ...t, [flag]: value } : t)),
  };
}

/**
 * クリップを複製して、**同じ列の空いている直後**へ置く（空いていなければ置けない＝理由を返す）。
 * 「置く」の最短経路（まず複製して動かす）として用意する。
 */
export function duplicateClip(doc: TimelineProject, clipId: string): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  const startSec = clipEndSec(clip);
  if (!isFreeSpan(doc.clips, clip.trackId, startSec, clip.durationSec)) return blocked(EDIT_BLOCKED.overlap);
  const next: TimelineClip = { ...clip, id: createClipId(doc.clips.map((c) => c.id)), startSec };
  return ok({ ...doc, clips: [...doc.clips, next] });
}
