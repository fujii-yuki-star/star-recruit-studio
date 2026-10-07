import { afterEach, describe, expect, it, vi } from 'vitest';

// synthesize は Tauri invoke と appSettings に依存するのでモックする（純関数テストは voicevoxProvider.test.ts）。
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock('../appSettings', () => ({ getVoicevoxSpeaker: () => null, getVoicevoxUrl: () => '' }));

import { VoicevoxProvider, synthesizeWithAccent } from './voicevoxProvider';
import { wavDurationSec } from '../../domain/voice/wavDuration';

/** 指定秒数の最小 WAV data URL を作る（wavDurationSec = dataSize/byteRate になるよう組む）。 */
function wavOfSeconds(sec: number): string {
  const byteRate = 1000;
  const dataSize = Math.round(sec * byteRate);
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const tag = (off: number, s: string) => { for (let i = 0; i < 4; i += 1) bytes[off + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); tag(8, 'WAVE');
  tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, byteRate, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, dataSize, true);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

describe('VoicevoxProvider.synthesize（尺は実 WAV から測る・#547 P3-3）', () => {
  afterEach(() => invokeMock.mockReset());

  it('文字数概算でなく wavDurationSec（実尺）を返す', async () => {
    const wav = wavOfSeconds(3); // 実尺 3 秒
    invokeMock.mockResolvedValue(wav);
    // text="あ"（1文字）＝旧概算なら max(1, round(1.8)/10)=1.0 秒。実尺 3 秒と食い違う値で差を出す。
    const { durationSec, audioDataUrl } = await new VoicevoxProvider().synthesize({ text: 'あ', voiceId: 'voicevox_zundamon', speed: 1, pitch: 0, intonation: 1 });
    expect(audioDataUrl).toBe(wav);
    expect(durationSec).toBeCloseTo(3, 1); // 実尺（wavDurationSec）
    expect(durationSec).not.toBeCloseTo(1, 1); // 文字数概算(=1.0)ではない
    expect(durationSec).toBe(wavDurationSec(wav)); // 呼び出し側の尺解決と同じ関数で導出
  });

  it('1秒未満の実尺もそのまま返す（旧 max(1,…) の1秒下限を撤去＝短い発話が正しく測れる）', async () => {
    const wav = wavOfSeconds(0.4); // 実尺 0.4 秒
    invokeMock.mockResolvedValue(wav);
    const { durationSec } = await new VoicevoxProvider().synthesize({ text: 'ん', voiceId: 'voicevox_zundamon', speed: 1, pitch: 0, intonation: 1 });
    expect(durationSec).toBeCloseTo(0.4, 1); // 旧実装なら 1.0 に切り上げられていた
    expect(durationSec).toBeLessThan(1);
  });

  it('不正 WAV は 0（呼び出し側で自動逐次フォールバック＝lineDurationsFromAudio と同じ扱い）', async () => {
    invokeMock.mockResolvedValue('data:audio/wav;base64,AAAA'); // 44バイト未満
    const { durationSec } = await new VoicevoxProvider().synthesize({ text: 'あ'.repeat(20), voiceId: 'voicevox_zundamon', speed: 1, pitch: 0, intonation: 1 });
    expect(durationSec).toBe(0); // 旧概算なら max(1, ...)=3.6 で 0 にならなかった＝実尺化の証拠
  });
});

/**
 * 読み方の聞き比べ（#350）で **Rust へ渡す形**を固定する。
 *
 * ⚠️ **話し方は3つで1組**（`style`）＝Rust 側は `VoiceStyle` で受け、スケールへの換算を
 * 声の作成（`synthesize_voice`）と共有している。ここが `speed`/`pitch`/`intonation` の
 * ばら渡しへ戻ると **受け取れずに落ちる**（型では検知できない境界なのでテストで留める）。
 */
describe('synthesizeWithAccent（Rust へ渡す形）', () => {
  afterEach(() => invokeMock.mockReset());

  it('話し方を style にまとめて渡す（ばらして渡さない）', async () => {
    // この関数はアプリの中でだけ Rust を呼ぶ（外では作り物の声）ので、その判定を満たしておく。
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    invokeMock.mockResolvedValue('data:audio/wav;base64,AA==');
    await synthesizeWithAccent('スタリオ', 1, { speed: 1.2, pitch: 0.3, intonation: 0.8, voiceId: 'voicevox_zundamon' });
    const [cmd, args] = invokeMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(cmd).toBe('voicevox_synthesize_with_accent');
    expect(args.style).toEqual({ speed: 1.2, pitch: 0.3, intonation: 0.8 });
    expect(args).not.toHaveProperty('speed');
    expect(args.yomi).toBe('スタリオ');
    expect(args.accentType).toBe(1);
    delete (globalThis as { window?: unknown }).window;
  });
});
