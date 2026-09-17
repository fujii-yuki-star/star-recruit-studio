// 頼まれた仕事を始めてよいか（ADR-0042・#1204）。**純粋関数**。
//
// ⚠️ **なぜ要るか**＝公開前チェックの「要対応」は**画面が人に見せて**いた。
// 起動の引数で走る回（ADR-0042）は**誰も画面を読まない**ので、その役目が**消える**。
// 実機で確かめた形＝外の AI が読み上げのセリフを書いて書き出すと、
// **−91dB の無音の動画**が**終了コード 0**（成功）で返っていた（#1194）。
//
// ⚠️ **人が押した回の挙動は変えない**＝画面が知らせる形のまま。ここは**頼まれた回だけ**の関門。
// ⚠️ **「警告」と「要対応」を混ぜない**＝使っていない素材のような警告では止めない
//（止めると、頼んだ側は**直しようのない断り**を受け取る）。

import { NARRATION_STATUS, TIMELINE_CLIP_KIND } from '../enums';
import type { Scene } from '../project/types';
import { sceneLines } from '../project/narrationLines';
import type { TimelineClip } from '../timeline/types';

/** 頼まれた仕事を断る理由（いまは1つだけ＝声が作られていない）。 */
export const STARTUP_NOT_READY = {
  /** 読み上げのセリフはあるのに、声がまだ作られていない（＝そのぶんが**無音で焼き込まれる**）。 */
  voiceNotGenerated: 'STARTUP_VOICE_NOT_GENERATED',
} as const;
export type StartupNotReady = (typeof STARTUP_NOT_READY)[keyof typeof STARTUP_NOT_READY];

/**
 * タイムライン形式で、**まだ作られていない読み上げ**の数。
 *
 * ⚠️ **文が空のものは数えない**＝元から鳴らないので、直しようがない。
 */
export function timelineUngeneratedVoices(clips: readonly TimelineClip[]): number {
  let n = 0;
  for (const c of clips) {
    if (c.kind !== TIMELINE_CLIP_KIND.voice || !c.voice) continue;
    if (c.voice.text.trim().length === 0) continue;
    if (c.voice.status !== NARRATION_STATUS.generated) n += 1;
  }
  return n;
}

/**
 * 場面形式で、**まだ作られていない読み上げ**を持つ場面の数。
 *
 * ⚠️ **掛け合いも単一のセリフも同じ見方で数える**（`sceneLines`）＝
 * 画面の公開前チェックと**同じ判定**を通す（形式や作りで数が食い違わない＝ADR-0026②）。
 */
export function sceneUngeneratedVoices(scenes: readonly Scene[]): number {
  let n = 0;
  for (const s of scenes) {
    if (sceneLines(s).some((l) => l.text.trim().length > 0 && l.status !== NARRATION_STATUS.generated)) n += 1;
  }
  return n;
}

/**
 * 頼まれた書き出しを**断るべきか**（`null`＝始めてよい）。
 *
 * ⚠️ **数ではなく「あるか」で返す**＝断りの文に数を出しても、頼んだ側の**次の行動は変わらない**。
 */
export function startupExportNotReady(input: {
  ungeneratedVoices: number;
}): StartupNotReady | null {
  if (input.ungeneratedVoices > 0) return STARTUP_NOT_READY.voiceNotGenerated;
  return null;
}
