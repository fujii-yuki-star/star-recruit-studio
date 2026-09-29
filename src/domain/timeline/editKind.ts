// 取り消す／やり直すの**中身の種類**（#1268）。純粋関数（§4・§7）。
//
// ⚠️ **履歴の積み方は変えない**＝編集の入口（約60か所）ごとに名前を渡すと、足した入口で書き忘れる
// （このリポジトリで繰り返している型）。**前後の文書を比べて**種類を決める＝入口が増えても漏れない。
// 言葉は画面の側（`uiLabels`）が持つ（domain は種類だけ）。
import type { TimelineProject } from './types';

export const TIMELINE_EDIT_KIND = {
  place: 'place',
  remove: 'remove',
  move: 'move',
  resize: 'resize',
  box: 'box',
  content: 'content',
  addTrack: 'addTrack',
  removeTrack: 'removeTrack',
  track: 'track',
  marker: 'marker',
  settings: 'settings',
  other: 'other',
} as const;
export type TimelineEditKind = (typeof TIMELINE_EDIT_KIND)[keyof typeof TIMELINE_EDIT_KIND];

/**
 * `before` → `after` の変更の種類。**いちばん目立つもの**を1つ返す（部品の増減 → 列の増減 → 部品の時間 →
 * 部品の箱 → 部品の中身 → 列の設定 → 目印 → 動画全体の設定 の順）。
 */
export function timelineEditKind(before: TimelineProject, after: TimelineProject): TimelineEditKind {
  const beforeClips = new Map(before.clips.map((c) => [c.id, c]));
  const afterIds = new Set(after.clips.map((c) => c.id));
  const added = after.clips.some((c) => !beforeClips.has(c.id));
  const removed = before.clips.some((c) => !afterIds.has(c.id));
  if (added && !removed) return TIMELINE_EDIT_KIND.place;
  if (removed && !added) return TIMELINE_EDIT_KIND.remove;
  if (added && removed) return TIMELINE_EDIT_KIND.other; // 分ける・バラす等（増えて減る）

  const beforeTracks = new Set(before.tracks.map((t) => t.id));
  const afterTracks = new Set(after.tracks.map((t) => t.id));
  if (after.tracks.some((t) => !beforeTracks.has(t.id))) return TIMELINE_EDIT_KIND.addTrack;
  if (before.tracks.some((t) => !afterTracks.has(t.id))) return TIMELINE_EDIT_KIND.removeTrack;

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
