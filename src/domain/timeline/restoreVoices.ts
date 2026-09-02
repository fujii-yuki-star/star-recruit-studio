// タイムライン形式で「前の状態に戻す」ときに、**文と音の食い違い**を作らないための解決（#977）。
//
// ⚠️ **場面形式と同じ理由**（`domain/project/restoreVoices.ts`）＝戻すのは `project.json` だけで、
// 作成済みの読み上げ（`voices/<クリップ id>.wav`）は**ディスクにそのまま残る**。素通りさせると
// 「文は戻った・音はいまの文」になり、**そのまま書き出すと字幕と声が違う動画が出る**。
//
// ⚠️ **比べ方は既にあるものを使う**（`resolveTimelineVoice` / `sameSynthInput`）＝
// 声を作り直すかどうかの判定を写すと、片方だけ直る（このリポジトリで繰り返している型）。
import { sameSynthInput } from '../voice/voiceProvider';
import { NARRATION_STATUS } from '../enums';
import { resolveTimelineVoice } from './voice';
import type { TimelineProject } from './types';

/** 戻した内容と、いまの内容を比べて外した件数。 */
export interface StaleTimelineVoiceCount {
  cleared: number;
}

/**
 * 戻す内容のうち、**いまと文（や声の設定）が違う読み上げ**を「作成前」へ戻す。
 *
 * ⚠️ **それぞれの文書の設定で解く**＝戻す内容といまの内容で、動画全体の声の設定が違うことがある。
 * ⚠️ **いまに無いクリップも「作成前」へ倒す**＝比べようが無いので、分からない側へ倒す
 * （音のファイルはクリップを消しても残る＝場面形式と同じ扱い）。
 */
export function clearStaleTimelineVoices(
  restored: TimelineProject,
  current: TimelineProject,
): { doc: TimelineProject; count: StaleTimelineVoiceCount } {
  const now = new Map(
    (current.clips ?? [])
      .filter((c) => c.voice != null)
      .map((c) => [c.id, { text: c.voice!.text, ...resolveTimelineVoice(c.voice!, current.voiceSettings ?? {}) }]),
  );
  let cleared = 0;
  const clips = (restored.clips ?? []).map((c) => {
    if (!c.voice || c.voice.status !== NARRATION_STATUS.generated) return c;
    const mine = { text: c.voice.text, ...resolveTimelineVoice(c.voice, restored.voiceSettings ?? {}) };
    const cur = now.get(c.id);
    if (cur !== undefined && sameSynthInput(mine, cur)) return c;
    cleared += 1;
    return { ...c, voice: { ...c.voice, status: NARRATION_STATUS.none, voicePath: null } };
  });
  return { doc: { ...restored, clips }, count: { cleared } };
}
