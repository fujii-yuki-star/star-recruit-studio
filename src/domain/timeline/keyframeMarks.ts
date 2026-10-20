// 選んだ部品の帯に出す「キーフレームの印」（#1186 ②・人の側＝実機で、どこに動きを置いたかが帯から分からなかった）。純粋関数。
//
// 型は CapCut・Premiere・After Effects＝選んだ部品の帯にひし形の印を出し、押すとその時刻へ移る（まず読むだけ＝印を引いて
// 時刻を動かすことはしない・ADR-0034 決定6）。
import type { TimelineProject } from './types';

/**
 * その部品**自身の**キーフレームの時刻（部品の先頭からの秒・重なりを除いて昇順）。帯の長さの外のキーは描かれない時刻なので出さない
 * （`motionPathOf` と同じ線引き＝印を押しても、その時刻に部品は出ていない）。
 * ⚠️ **まとまり（グループ）の動きは出さない**＝この部品の帯の上に、別の物（まとまり）の動きの印を混ぜない。
 */
export function clipKeyframeTimes(doc: TimelineProject, clipId: string): number[] {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return [];
  const anim = (doc.animations ?? []).find((a) => a.targetId === clipId);
  if (!anim) return [];
  const times = anim.keyframes.map((k) => k.timeSec).filter((t) => t >= 0 && t <= clip.durationSec);
  return [...new Set(times)].sort((a, b) => a - b);
}
