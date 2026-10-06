// 描かれる字幕を時刻つきで取り出す（字幕ファイルの書き出し＝ADR-0055 決定4・#1351）。純粋関数。
//
// ⚠️ **取り出し方はここに1つ**＝場面形式も焼き出し（`bakeTimelineProject`）を通してからここへ来る
//   （形式ごとに規則を書かない）。描画（`renderer/timelineLayout`）と同じ部品から同じ文を解く：
//   字幕クリップ＝`subtitleTextOf`（自分の文・無ければ連動先の読み上げ文）／見た目パターンのクリップ＝
//   `sceneFromClip` → `sceneDisplayedSubtitleTexts`（字幕の層が描く文）。
// ⚠️ **描かれないものは出さない**＝隠した列・隠した部品・隠したまとまりの中・空の文。

import { isHiddenByGroup } from '../group/compose';
import { TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { sceneDisplayedSubtitleTexts } from '../project/subtitleBinding';
import type { SubtitleCue } from '../subtitle/subtitleFile';
import type { Template } from '../template/types';
import { sceneFromClip } from './sceneFromClip';
import { subtitleTextOf } from './subtitleLink';
import type { TimelineClip, TimelineProject } from './types';

/** 部品1つが描く字幕の文（無ければ空の配列）。 */
function clipSubtitleTexts(
  doc: TimelineProject,
  clip: TimelineClip,
  templateOf: (templateId: string) => Template | undefined,
): string[] {
  if (clip.kind === TIMELINE_CLIP_KIND.subtitle) {
    const t = subtitleTextOf(doc, clip);
    return t ? [t] : [];
  }
  if (clip.kind === TIMELINE_CLIP_KIND.template) {
    const template = templateOf(clip.templateId ?? '');
    // 見た目が見つからない部品は描かれない（`timelineLayout` と同じ）＝字幕も出さない。
    if (!template) return [];
    return sceneDisplayedSubtitleTexts(sceneFromClip(clip, template), template);
  }
  return [];
}

/**
 * 文書から**描かれる字幕**を時刻順に取り出す（ADR-0055 決定4）。
 * 同じ部品が字幕の層を複数持つときは、同じ時刻の字幕として別々に出す（同じ文は1つにまとめる）。
 */
export function subtitleCuesOf(
  doc: TimelineProject,
  templateOf: (templateId: string) => Template | undefined,
): SubtitleCue[] {
  const groups = doc.groups ?? [];
  const cues: SubtitleCue[] = [];
  for (const track of doc.tracks) {
    if (track.kind !== TRACK_KIND.visual || track.hidden) continue;
    for (const clip of doc.clips) {
      if (clip.trackId !== track.id || clip.hidden || isHiddenByGroup(clip.id, groups)) continue;
      const texts = [...new Set(clipSubtitleTexts(doc, clip, templateOf).map((t) => t.trim()).filter((t) => t !== ''))];
      for (const text of texts) cues.push({ startSec: clip.startSec, endSec: clip.startSec + clip.durationSec, text });
    }
  }
  cues.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  return cues;
}
