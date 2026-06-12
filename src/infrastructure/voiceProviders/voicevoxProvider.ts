// VOICEVOX ローカルエンジンで音声合成する VoiceProvider 実装（Tauri コマンド越し）。
// Rust 側（voicevox.rs）が localhost:50021 に HTTP 接続する。ブラウザ開発では使わず Mock にフォールバック（store で選択）。
import { invoke } from '@tauri-apps/api/core';
import type { SynthesizeInput, SynthesizedVoice, VoiceProvider } from '../../domain/voice/voiceProvider';

// 本アプリの voiceId → VOICEVOX の speaker(スタイル)番号。
const SPEAKER_BY_VOICE_ID: Record<string, number> = {
  voicevox_zundamon: 3, // ずんだもん（ノーマル）
};
const DEFAULT_SPEAKER = 3;

export class VoicevoxProvider implements VoiceProvider {
  async synthesize(input: SynthesizeInput): Promise<SynthesizedVoice> {
    const speaker = SPEAKER_BY_VOICE_ID[input.voiceId] ?? DEFAULT_SPEAKER;
    const audioDataUrl = await invoke<string>('synthesize_voice', {
      text: input.text,
      speaker,
      speed: input.speed,
      pitch: input.pitch,
      intonation: input.intonation,
    });
    // 尺は文字数からの概算（正確な尺は V-C の音声ミックス時に WAV から取得予定）。
    const durationSec = Math.max(1, Math.round(input.text.length * 1.8) / 10);
    return { audioDataUrl, durationSec };
  }
}
