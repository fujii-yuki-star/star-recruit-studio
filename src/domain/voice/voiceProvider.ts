// ナレーション音声の抽象（VoiceProvider）。実装は infrastructure に置く（Mock / 将来 VOICEVOX）。
// CLAUDE.md §4（外部I/Oは抽象化）/ ADR-0003（ずんだもん＝ナレーター・差し替え可能）/ 13 §4。
import { DEFAULT_VOICE_ID } from '../constants';
import type { Narration, NarrationLine, VoiceSettings } from '../project/types';

export interface SynthesizeInput {
  text: string;
  voiceId: string;
  speed: number;
  pitch: number;
  intonation: number;
  /** 掛け合いの行ごと話者（#177 voiceCatalog の speaker）。指定時は app 設定より優先。null/未指定＝voiceId 経路で解決（ADR-0015）。 */
  speaker?: number | null;
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

/**
 * 掛け合いの1行の合成入力を解決する（ADR-0015 PR-C2）。base＝resolveNarrationVoice（場面/既定声）。
 * - speed/pitch は 行→base（場面/既定）を継承。intonation は行に持たず base を継承。
 * - speaker は行に明示があればそれ（app 設定より優先）、無ければ null＝voiceId 経路（app 設定→既定）で解決。
 */
export function resolveLineVoice(line: NarrationLine, base: ResolvedVoice): SynthesizeInput {
  return {
    text: line.text,
    voiceId: base.voiceId,
    speed: line.speed ?? base.speed,
    pitch: line.pitch ?? base.pitch,
    intonation: base.intonation,
    speaker: line.speaker ?? null,
  };
}
