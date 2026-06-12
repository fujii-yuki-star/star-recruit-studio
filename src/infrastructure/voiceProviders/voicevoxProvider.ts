// VOICEVOX ローカルエンジンで音声合成する VoiceProvider 実装（Tauri コマンド越し）。
// Rust 側（voicevox.rs）が接続先（設定 or 既定 localhost:50021）に HTTP 接続する。
// ブラウザ開発では使わず Mock にフォールバック（store で選択）。
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_VOICE_ID } from '../../domain/constants';
import { getVoicevoxSpeaker, getVoicevoxUrl } from '../appSettings';
import type { SynthesizeInput, SynthesizedVoice, VoiceProvider } from '../../domain/voice/voiceProvider';

// 本アプリの voiceId → VOICEVOX の speaker(スタイル)番号。
const DEFAULT_SPEAKER = 3; // ずんだもん（ノーマル）
const SPEAKER_BY_VOICE_ID: Record<string, number> = {
  [DEFAULT_VOICE_ID]: DEFAULT_SPEAKER,
};

/**
 * ナレーター（ずんだもん）の選べるスタイルと VOICEVOX の speaker 番号。
 * ADR-0003：ナレーター＝ずんだもんに限定する（「VOICEVOX:ずんだもん」クレジットを保つため、他キャラは選ばせない）。
 */
export const ZUNDAMON_STYLES: { speaker: number; label: string }[] = [
  { speaker: 3, label: 'ノーマル' },
  { speaker: 1, label: 'あまあま' },
  { speaker: 7, label: 'ツンツン' },
  { speaker: 5, label: 'セクシー' },
  { speaker: 22, label: 'ささやき' },
];

/** 使用する speaker を解決：設定の話者 → voiceId マップ → 既定（純粋・テスト可能）。 */
export function resolveSpeaker(settingSpeaker: number | null, voiceId: string): number {
  return settingSpeaker ?? SPEAKER_BY_VOICE_ID[voiceId] ?? DEFAULT_SPEAKER;
}

export class VoicevoxProvider implements VoiceProvider {
  async synthesize(input: SynthesizeInput): Promise<SynthesizedVoice> {
    const speaker = resolveSpeaker(getVoicevoxSpeaker(), input.voiceId);
    const baseUrl = getVoicevoxUrl();
    const audioDataUrl = await invoke<string>('synthesize_voice', {
      text: input.text,
      speaker,
      speed: input.speed,
      pitch: input.pitch,
      intonation: input.intonation,
      // 空なら Rust 側が環境変数→既定にフォールバックする。
      baseUrl: baseUrl || null,
    });
    // 尺は文字数からの概算（正確な尺は将来 WAV から取得予定）。
    const durationSec = Math.max(1, Math.round(input.text.length * 1.8) / 10);
    return { audioDataUrl, durationSec };
  }
}
