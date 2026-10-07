// タイムライン形式の読み上げの、**声の設定の解決**（null=継承・`11 §6`）。
//
// ⚠️ **domain に置く**（#977）＝もとは `timelineStore` の中にあったが、戻すときの突き合わせ
// （`clearStaleTimelineVoices`）でも同じ解決が要る。写すと**片方だけ直る**ので、単一の参照元にする。
import { characterForSpeaker } from '../voice/voiceCatalog';
import { resolveNarrationVoice } from '../voice/voiceProvider';
import type { VoiceSettings } from '../project/types';
import { NARRATION_STATUS, TIMELINE_CLIP_KIND } from '../enums';
import type { TimelineClip, TimelineVoice } from './types';

/** 読み上げクリップの声の設定を、動画全体の既定で埋めて返す。 */
export function resolveTimelineVoice(voice: TimelineVoice, settings: VoiceSettings) {
  const resolved = resolveNarrationVoice(
    { text: voice.text, status: voice.status, speed: voice.speed, pitch: voice.pitch, intonation: voice.intonation },
    settings,
  );
  // catalog に無い話者は既定の声へ落とす（場面形式の `resolveLineVoice`＝V19 と同じ扱い）。
  const speaker = voice.speaker != null && characterForSpeaker(voice.speaker) != null ? voice.speaker : null;
  return { ...resolved, speaker };
}

/**
 * **まだ声を作っていない読み上げ**か（#1019 ⑥）。純粋・副作用なし。
 *
 * ⚠️ **場面形式と同じ規準**（`sceneNeedsVoice`）＝**文があって、まだ作成済みでない**もの。
 * 作成済みは個別の「声を作り直す」で上書きするので、まとめて作る対象には入れない
 * （まとめて押すたびに作り直すと、作った声が黙って捨てられる）。
 * ⚠️ **空の文は対象外**＝鳴らないものを作りにいかない（V28 が別に案内している）。
 */
export function voiceClipNeedsVoice(clip: TimelineClip): boolean {
  if (clip.kind !== TIMELINE_CLIP_KIND.voice || !clip.voice) return false;
  return clip.voice.text.trim().length > 0 && clip.voice.status !== NARRATION_STATUS.generated;
}

/**
 * まとめて作る進み具合（作成済み / 文のある読み上げの数）。
 *
 * ⚠️ **分母は「文のある読み上げ」**＝空の文を数えると、いつまでも終わらない分母になる。
 */
export function timelineVoiceProgress(clips: readonly TimelineClip[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const c of clips) {
    if (c.kind !== TIMELINE_CLIP_KIND.voice || !c.voice) continue;
    if (c.voice.text.trim().length === 0) continue;
    total += 1;
    if (c.voice.status === NARRATION_STATUS.generated) done += 1;
  }
  return { done, total };
}

