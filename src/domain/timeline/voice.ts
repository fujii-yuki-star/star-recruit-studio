// タイムライン形式の読み上げの、**声の設定の解決**（null=継承・`11 §6`）。
//
// ⚠️ **domain に置く**（#977）＝もとは `timelineStore` の中にあったが、戻すときの突き合わせ
// （`clearStaleTimelineVoices`）でも同じ解決が要る。写すと**片方だけ直る**ので、単一の参照元にする。
import { characterForSpeaker } from '../voice/voiceCatalog';
import { resolveNarrationVoice } from '../voice/voiceProvider';
import type { VoiceSettings } from '../project/types';
import type { TimelineVoice } from './types';

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
