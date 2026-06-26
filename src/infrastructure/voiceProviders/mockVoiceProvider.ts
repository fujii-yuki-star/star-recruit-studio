// 開発・テスト用のダミー音声合成。無音WAVを返し、ナレーション生成フローを通す（AiProvider と同じ Mock 先行）。
// 実音声は VOICEVOX プロバイダ（V-B：infrastructure/voicevox でローカルエンジンに HTTP 接続）で差し替える（13 §4 / ADR-0003）。
import type { SynthesizeInput, SynthesizedVoice, VoiceProvider } from '../../domain/voice/voiceProvider';

/** 指定秒数の無音WAVを data URL で返す（8kHz/16bit/モノラル）。 */
function silentWavDataUrl(durationSec: number): string {
  const sampleRate = 8000;
  const numSamples = Math.max(1, Math.round(sampleRate * durationSec));
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // モノラル
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  // data 部はゼロ（無音）。
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export class MockVoiceProvider implements VoiceProvider {
  synthesize(input: SynthesizeInput): Promise<SynthesizedVoice> {
    // 日本語のおおよその発話尺（1文字 ≈ 0.18 秒、最低 1 秒）。
    const durationSec = Math.max(1, Math.round(input.text.length * 1.8) / 10);
    return Promise.resolve({ audioDataUrl: silentWavDataUrl(durationSec), durationSec });
  }
}
