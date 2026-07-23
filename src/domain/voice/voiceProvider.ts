// ナレーション音声の抽象（VoiceProvider）。実装は infrastructure に置く（Mock / 将来 VOICEVOX）。
// CLAUDE.md §4（外部I/Oは抽象化）/ ADR-0003（ずんだもん＝ナレーター・差し替え可能）/ 13 §4。
import { DEFAULT_VOICE_ID } from '../constants';
import { characterForSpeaker } from './voiceCatalog';
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
  /** 合成音声(WAV)の実尺（秒）＝`wavDurationSec` で測定。解析不能時は 0（呼び出し側で自動逐次フォールバック）。 */
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
 * - speed/pitch/intonation は 行→base（場面/既定）を継承（#242 で intonation も行ごとに調整可）。
 * - speaker は行に明示があればそれ（app 設定より優先）、無ければ null＝voiceId 経路（app 設定→既定）で解決。
 */
export function resolveLineVoice(line: NarrationLine, base: ResolvedVoice): SynthesizeInput {
  return {
    text: line.text,
    voiceId: base.voiceId,
    speed: line.speed ?? base.speed,
    pitch: line.pitch ?? base.pitch,
    intonation: line.intonation ?? base.intonation,
    // voiceCatalog に無い speaker（破損データ等）は null＝既定声へフォールバック（V19「標準の声を使います」を満たす）。
    speaker: characterForSpeaker(line.speaker) != null ? line.speaker : null,
  };
}

/**
 * 合成入力が同一か（本文/声/速さ/ピッチ/抑揚/話者）。合成は非同期で、await 中に本文や話し方を編集できるため、
 * 完了時に「合成した入力＝いまの入力」を確かめて、一致するときだけ結果を採用する（旧結果を新しい本文に紐付けない・#390 レビュー）。
 */
export function sameSynthInput(a: SynthesizeInput, b: SynthesizeInput): boolean {
  return (
    a.text === b.text &&
    a.voiceId === b.voiceId &&
    a.speed === b.speed &&
    a.pitch === b.pitch &&
    a.intonation === b.intonation &&
    (a.speaker ?? null) === (b.speaker ?? null)
  );
}
