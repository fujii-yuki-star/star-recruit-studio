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

  it('fmt チャンクが末尾で切れた WAV でも例外を投げず 0（境界チェック）', () => {
    // RIFF/WAVE の後に JUNK(16B) を置き、'fmt ' を off=36 に配置（off+20=56 > 44）＝byteRate 読みが範囲外。
    const buf = new Uint8Array(44);
    const dv = new DataView(buf.buffer);
    const setTag = (o: number, s: string): void => { for (let i = 0; i < 4; i += 1) buf[o + i] = s.charCodeAt(i); };
    setTag(0, 'RIFF'); setTag(8, 'WAVE');
    setTag(12, 'JUNK'); dv.setUint32(16, 16, true); // 次チャンクは 12+8+16=36
    setTag(36, 'fmt '); dv.setUint32(40, 16, true); // fmt 宣言だが本体が無い（切れている）
    const b64 = btoa(String.fromCharCode(...buf));
    expect(wavDurationSec(`data:audio/wav;base64,${b64}`)).toBe(0);
  });
});
