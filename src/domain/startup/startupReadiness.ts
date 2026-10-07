// 頼まれた仕事を始めてよいか（ADR-0042・#1204）。**純粋関数**。
//
// ⚠️ **なぜ要るか**＝公開前チェックの「要対応」は**画面が人に見せて**いた。
// 起動の引数で走る回（ADR-0042）は**誰も画面を読まない**ので、その役目が**消える**。
// 実機で確かめた形＝外の AI が読み上げのセリフを書いて書き出すと、
// **−91dB の無音の動画**が**終了コード 0**（成功）で返っていた（#1194）。
//
// ⚠️ **人が押した回の挙動は変えない**＝画面が知らせる形のまま。ここは**頼まれた回だけ**の関門。
// ⚠️ **「要対応」を全部止めるのではない**（PR #1208 レビュー）＝基準は
// **「黙って別の結果になるもの」**（声が鳴らない・場面が抜ける）。
// 「字幕が長い」のような**助言**では止めない＝止めると、頼んだ側は**直しようのない断り**を受け取る。
// ⚠️ **「警告」と「要対応」を混ぜない**＝使っていない素材のような警告では止めない
//（止めると、頼んだ側は**直しようのない断り**を受け取る）。

import type { Scene } from '../project/types';
import { sceneNeedsVoice } from '../project/narrationLines';
import { voiceClipNeedsVoice } from '../timeline/voice';
import type { TimelineClip } from '../timeline/types';

/** 頼まれた仕事を断る理由（いまは1つだけ＝声が作られていない）。 */
export const STARTUP_NOT_READY = {
  /** 読み上げのセリフはあるのに、声がまだ作られていない（＝そのぶんが**無音で焼き込まれる**）。 */
  voiceNotGenerated: 'STARTUP_VOICE_NOT_GENERATED',
  /**
   * **使っている**のにファイルが見つからない素材がある（PR #1208 レビュー 🟡）。
   *
   * ⚠️ **いまここでは数えていません**（#1068）＝**両形式とも書き出しの画面／関門が断る**ようになったので、
   * ここでも数えると**同じ状態に2つの断りが並び**、しかも**数え方が画面と違う**
   *（画面は「テンプレの差し込み口に入っているか」で数える＝`sceneActiveAssetIds`）。
   * ⚠️ **語彙は残します**＝将来「画面より先に断りたい」状態が出たときの受け皿
   *（そのときは**画面と同じ判定**を呼ぶこと）。
   */
  assetMissing: 'STARTUP_ASSET_MISSING',
} as const;
export type StartupNotReady = (typeof STARTUP_NOT_READY)[keyof typeof STARTUP_NOT_READY];

/**
 * タイムライン形式で、**まだ作られていない読み上げ**の数。
 *
 * ⚠️ **文が空のものは数えない**＝元から鳴らないので、直しようがない。
 */
export function timelineUngeneratedVoices(clips: readonly TimelineClip[]): number {
  // ⚠️ **判定は画面と同じものを呼ぶ**（PR #1208 レビュー ℹ️）＝同じ条件を書き写すと、
  // どちらか一方だけ変えたときに**公開前チェックと起動の口がずれる**（このPRが警戒している当のもの）。
  return clips.filter(voiceClipNeedsVoice).length;
}

/**
 * 場面形式で、**まだ作られていない読み上げ**を持つ場面の数。
 *
 * ⚠️ **掛け合いも単一のセリフも同じ見方で数える**（`sceneLines`）＝
 * 画面の公開前チェックと**同じ判定**を通す（形式や作りで数が食い違わない＝ADR-0026②）。
 */
export function sceneUngeneratedVoices(scenes: readonly Scene[]): number {
  // ⚠️ **判定は画面と同じものを呼ぶ**（上と同じ理由）。
  return scenes.filter(sceneNeedsVoice).length;
}

/**
 * 頼まれた書き出しを**断るべきか**（`null`＝始めてよい）。
 *
 * ⚠️ **数ではなく「あるか」で返す**＝断りの文に数を出しても、頼んだ側の**次の行動は変わらない**。
 */
export function startupExportNotReady(input: {
  ungeneratedVoices: number;
  /** **使っている**のにファイルが見つからない素材の数（`0`＝無い／調べていないときも `0`）。 */
  missingUsedAssets: number;
}): StartupNotReady | null {
  if (input.ungeneratedVoices > 0) return STARTUP_NOT_READY.voiceNotGenerated;
  if (input.missingUsedAssets > 0) return STARTUP_NOT_READY.assetMissing;
  return null;
}

