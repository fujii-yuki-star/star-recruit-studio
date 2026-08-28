// タイムライン形式（ADR-0032）のクレジット表示（#631）。純粋関数（副作用なし・§7 テスト対象）。
//
// VOICEVOX のクレジットは**動画に表示する**（ADR-0003・`13 §4`）。場面形式は掛け合いの行ごとに
// 実際にしゃべっているキャラを出す（`creditForLine`）ので、タイムラインでも同じにする＝
// **同じ概念は同じ挙動**（ADR-0026②）。ここは「その時刻に誰がしゃべっているか」だけを決め、
// 文言そのものは `domain/voice/narratorCredit` が持つ（文言の散逸を防ぐ・§6）。
import { TIMELINE_CLIP_KIND } from '../enums';
import { creditVisibleAt } from '../voice/creditDisplay';
import { creditForLine } from '../voice/narratorCredit';
import { timelineFramePlan } from './export';
import type { TimelineProject } from './types';
import { clipEndSec } from './validateTimelineDoc';

/**
 * その時刻にしゃべっている声の話者（VOICEVOX speaker）。誰もしゃべっていなければ `null`
 * （呼ぶ側が動画の既定話者のクレジットへ落とす＝クレジットが消える瞬間を作らない）。
 *
 * 同時に複数の声が鳴っているときは**先に始まったほう**（同時開始なら id の順）＝時刻から一意に決まる。
 * 鳴らないもの（隠した部品・隠した列・まだ作っていない読み上げ）は対象外＝聞こえない声のキャラを
 * 表示しない（実際に合成した声とクレジットを一致させる）。
 */
export function creditSpeakerAt(doc: TimelineProject, timeSec: number): number | null {
  const hiddenTrackIds = new Set(doc.tracks.filter((t) => t.hidden).map((t) => t.id));
  const live = doc.clips
    .filter(
      (c) =>
        c.kind === TIMELINE_CLIP_KIND.voice &&
        // **まだ作っていない読み上げは数えない**＝鳴らない声のキャラを名乗らない（自己申告と実際を合わせる）。
        !!c.voice?.voicePath &&
        !c.hidden &&
        !hiddenTrackIds.has(c.trackId) &&
        timeSec >= c.startSec &&
        timeSec < clipEndSec(c),
    )
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id));
  return live[0]?.voice?.speaker ?? null;
}

/**
 * その時刻に**描くクレジットの文言**。出さない時刻は `undefined`（呼ぶ側は `credit` を渡さない）。
 *
 * ⚠️ **プレビューと書き出しはこの1つを通す**（PR #881 レビュー）。前は書き出しだけが
 * `creditVisibleAt` を通しており、「最初の数秒」「非表示」を選んだ動画が**編集画面では出ているのに
 * 焼いた動画には入っていない**（またはその逆）状態になっていた＝ADR-0001 の一致がここで割れる。
 * 「同じ関数で決める」とコメントに書くだけでは割れるので、**呼び口そのものを1つにする**。
 *
 * 尺は `timelineFramePlan`（＝書き出しが実際に描く枚数から導く尺）から採る＝プレビューが
 * `timelineDurationSec` を直接見ると、端数フレームの切り上げぶんだけ末尾の窓がずれる。
 */
export function creditTextAt(
  doc: TimelineProject,
  timeSec: number,
  fallbackCredit: string,
): string | undefined {
  if (!creditVisibleAt(doc.videoSettings.creditDisplay, timelineFramePlan(doc).durationSec, timeSec)) {
    return undefined;
  }
  return creditForLine({ speaker: creditSpeakerAt(doc, timeSec) }, fallbackCredit);
}
