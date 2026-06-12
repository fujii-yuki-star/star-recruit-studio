// ナレーション音声の抽象（VoiceProvider）。実装は infrastructure に置く（Mock / 将来 VOICEVOX）。
// CLAUDE.md §4（外部I/Oは抽象化）/ ADR-0003（ずんだもん＝ナレーター・差し替え可能）/ 13 §4。
import { DEFAULT_VOICE_ID } from '../constants';
import type { Narration, VoiceSettings } from '../project/types';

export interface SynthesizeInput {
  text: string;
  voiceId: string;
  speed: number;
  pitch: number;
  intonation: number;
}

export interface SynthesizedVoice {
  /** 合成音声(WAV)の data URL。再生・将来の音声ミックスに使う。 */
  audioDataUrl: string;
  /** おおよその尺（秒）。 */
  durationSec: number;
}

export interface VoiceProvider {
  synthesize(input: SynthesizeInput): Promise<SynthesizedVoice>;
}

export interface ResolvedVoice {
  voiceId: string;
  speed: number;
  pitch: number;
  intonation: number;
}

/**
 * scene.narration の null/未指定フィールドを project.voiceSettings で補完する（11 §6：null=継承）。
 * voiceId は scene → project → システム定数(DEFAULT_VOICE_ID) の3段フォールバック（project側が空でも既定へ）。
 */
export function resolveNarrationVoice(narration: Narration, voice: VoiceSettings): ResolvedVoice {
  return {
    voiceId: narration.voiceId ?? (voice.defaultVoiceId || DEFAULT_VOICE_ID),
    speed: narration.speed ?? voice.speed ?? 1.0,
    pitch: narration.pitch ?? voice.pitch ?? 0.0,
    intonation: narration.intonation ?? voice.intonation ?? 1.0,
  };
}
