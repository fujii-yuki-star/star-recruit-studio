// 取り消す／やり直すの**中身の種類**（#1268）。純粋関数（§4・§7）。
//
// ⚠️ **履歴の積み方は変えない**＝編集の入口（約60か所）ごとに名前を渡すと、足した入口で書き忘れる
// （このリポジトリで繰り返している型）。**前後の文書を比べて**種類を決める＝入口が増えても漏れない。
// 言葉は画面の側（`uiLabels`）が持つ（domain は種類だけ）。
import type { TimelineClip, TimelineProject } from './types';

export const TIMELINE_EDIT_KIND = {
  place: 'place',
  duplicate: 'duplicate',
  split: 'split',
  remove: 'remove',
  move: 'move',
  resize: 'resize',
  box: 'box',
  content: 'content',
  addTrack: 'addTrack',
  duplicateTrack: 'duplicateTrack',
  removeTrack: 'removeTrack',
  reorderTracks: 'reorderTracks',
  track: 'track',
  marker: 'marker',
  settings: 'settings',
  other: 'other',
} as const;
export type TimelineEditKind = (typeof TIMELINE_EDIT_KIND)[keyof typeof TIMELINE_EDIT_KIND];

/** 時刻の比べ（秒の浮動小数の誤差を見逃す）。 */
const EPS = 1e-6;

/** 中身が同じか（id・置き場所・時刻を除いて）＝複製で増えたものを見分ける。 */
function sameContent(a: TimelineClip, b: TimelineClip): boolean {
  const strip = (c: TimelineClip) => {
    const { id: _id, startSec: _s, trackId: _t, ...rest } = c;
    return JSON.stringify(rest);
  };
  return strip(a) === strip(b);
}

/**
 * `before` → `after` の変更の種類。**いちばん目立つもの**を1つ返す。見る順（理由）：
 * 1. **列の増減・並び**＝列を消すと中の部品も消えるので、部品の増減より先に見ないと「部品を削除」と言ってしまう
 *    （#1270 レビュー）。ただし**部品を置くために手前へ列を足した**（#1252）は「部品を置く」と言う。
 * 2. **部品の増減**＝分ける（元が縮み、続きに1つ増える）・複製（中身が同じものが増える）・置く・削除。
 * 3. 部品の時間 → 箱 → 中身 → 列の設定 → 目印 → 動画全体の設定。
 */
export function timelineEditKind(before: TimelineProject, after: TimelineProject): TimelineEditKind {
  const beforeClips = new Map(before.clips.map((c) => [c.id, c]));
  const afterClips = new Map(after.clips.map((c) => [c.id, c]));
  const addedClips = after.clips.filter((c) => !beforeClips.has(c.id));
  const removedClips = before.clips.filter((c) => !afterClips.has(c.id));

  const beforeTracks = new Set(before.tracks.map((t) => t.id));
  const afterTracks = new Set(after.tracks.map((t) => t.id));
  const tracksAdded = after.tracks.some((t) => !beforeTracks.has(t.id));
  const tracksRemoved = before.tracks.some((t) => !afterTracks.has(t.id));
  const isDuplicateOfExisting = (c: TimelineClip) => before.clips.some((b) => sameContent(b, c));

  if (tracksRemoved && !tracksAdded) return TIMELINE_EDIT_KIND.removeTrack;
  if (tracksAdded && !tracksRemoved) {
    if (addedClips.length === 0) return TIMELINE_EDIT_KIND.addTrack;
    // 列ごと複製＝足した列に、**既にある1本の列の部品が全部**（同じ時刻・同じ中身で）並ぶ。
    // ⚠️ **2つ以上のときだけ**＝置くために手前へ列を足した（#1252）は**必ず1つ**なので、中身が既定の文字と
    //   同じでも取り違えない。代わりに「部品1つの列を複製」は「部品を置く」と言う（前後の文書だけでは見分けられない）。
    const mirrorsOneTrack = before.tracks.some((t) => {
      const src = before.clips.filter((c) => c.trackId === t.id);
      return src.length === addedClips.length && src.every((c) =>
        addedClips.some((a) => Math.abs(a.startSec - c.startSec) < EPS && sameContent(a, c)));
    });
    if (addedClips.length >= 2 && mirrorsOneTrack) return TIMELINE_EDIT_KIND.duplicateTrack;
    return TIMELINE_EDIT_KIND.place; // 置くために手前へ列を足した（#1252）
  }
  if (!tracksAdded && !tracksRemoved && addedClips.length === 0 && removedClips.length === 0
    && before.tracks.map((t) => t.id).join() !== after.tracks.map((t) => t.id).join()) {
    return TIMELINE_EDIT_KIND.reorderTracks;
  }

  if (addedClips.length > 0 && removedClips.length === 0) {
    // 分ける＝元の部品が縮み、その終わりちょうどから同じ列に1つ増える（元の id は前半に残る＝`splitClip`）。
    const isSplit = addedClips.every((a) => {
      for (const [id, b] of beforeClips) {
        const now = afterClips.get(id);
        if (!now || now.trackId !== a.trackId || b.trackId !== a.trackId) continue;
        if (now.durationSec < b.durationSec - EPS && Math.abs(now.startSec + now.durationSec - a.startSec) < EPS) return true;
      }
      return false;
    });
    if (isSplit) return TIMELINE_EDIT_KIND.split;
    if (addedClips.every(isDuplicateOfExisting)) return TIMELINE_EDIT_KIND.duplicate;
    return TIMELINE_EDIT_KIND.place;
  }
  if (removedClips.length > 0 && addedClips.length === 0) return TIMELINE_EDIT_KIND.remove;
  if (addedClips.length > 0 && removedClips.length > 0) return TIMELINE_EDIT_KIND.other; // バラす等（元が消えて増える）

  let moved = false;
  let resized = false;
  let boxed = false;
  let content = false;
  for (const c of after.clips) {
    const b = beforeClips.get(c.id);
    if (!b || b === c) continue;
    if (b.startSec !== c.startSec || b.trackId !== c.trackId) moved = true;
    else if (b.durationSec !== c.durationSec) resized = true;
    else if (hasBox(b) && hasBox(c) && (b.x !== c.x || b.y !== c.y || b.w !== c.w || b.h !== c.h || b.rotation !== c.rotation)) boxed = true;
    else content = true;
  }
  if (moved) return TIMELINE_EDIT_KIND.move;
  if (resized) return TIMELINE_EDIT_KIND.resize;
  if (boxed) return TIMELINE_EDIT_KIND.box;
  if (content) return TIMELINE_EDIT_KIND.content;

  if (before.tracks !== after.tracks && JSON.stringify(before.tracks) !== JSON.stringify(after.tracks)) return TIMELINE_EDIT_KIND.track;
  if (before.markers !== after.markers && JSON.stringify(before.markers ?? []) !== JSON.stringify(after.markers ?? [])) return TIMELINE_EDIT_KIND.marker;
  if (JSON.stringify(before.videoSettings) !== JSON.stringify(after.videoSettings)) return TIMELINE_EDIT_KIND.settings;
  return TIMELINE_EDIT_KIND.other;
}

function hasBox(c: object): c is { x?: number; y?: number; w?: number; h?: number; rotation?: number } {
  return 'x' in c || 'w' in c;
}
