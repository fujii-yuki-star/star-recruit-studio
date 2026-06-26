import { describe, expect, it } from 'vitest';
import { MockVoiceProvider } from '../../infrastructure/voiceProviders/mockVoiceProvider';
import { wavDurationSec } from './wavDuration';

describe('wavDurationSec', () => {
  it('MockVoiceProvider が返す WAV の尺をヘッダから復元できる（合成尺と一致）', async () => {
    const mock = new MockVoiceProvider();
    const { audioDataUrl, durationSec } = await mock.synthesize({
      text: 'こんにちは、ナレーションのテストです。', voiceId: 'v', speed: 1, pitch: 0, intonation: 1,
    });
    expect(wavDurationSec(audioDataUrl)).toBeCloseTo(durationSec, 1);
  });

  it('生 base64（data URL でない）でも解析できる', async () => {
    const mock = new MockVoiceProvider();
    const { audioDataUrl } = await mock.synthesize({ text: 'あ', voiceId: 'v', speed: 1, pitch: 0, intonation: 1 });
    const rawBase64 = audioDataUrl.slice(audioDataUrl.indexOf(',') + 1);
    expect(wavDurationSec(rawBase64)).toBeGreaterThan(0);
  });

  it('空・短すぎ・不正入力は 0（自動逐次フォールバック）', () => {
    expect(wavDurationSec('')).toBe(0);
    expect(wavDurationSec('data:audio/wav;base64,AAAA')).toBe(0); // 44バイト未満
    expect(wavDurationSec('not-a-wav!!!')).toBe(0);
  });
});
