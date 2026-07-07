import { describe, expect, it } from 'vitest';
import { sliceWav } from './wavSlice';
import { wavDurationSec } from './wavDuration';

// 合成 WAV（PCM16・mono・指定 sampleRate）。data は 0..frames-1 を 16bit LE で詰める（切り出し位置の検証用）。
function makeWav(sampleRate: number, frames: number): string {
  const blockAlign = 2; // mono 16bit
  const dataSize = frames * blockAlign;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const tag = (off: number, s: string): void => {
    for (let i = 0; i < 4; i += 1) bytes[off + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < frames; i += 1) view.setUint16(44 + i * 2, i & 0xffff, true);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

function dataBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  // 44 バイトヘッダ以降が PCM。
  return bytes.subarray(44);
}

describe('sliceWav', () => {
  it('先頭からの切り出しは尺どおりで、PCM が元の先頭サンプルから始まる', () => {
    const wav = makeWav(8000, 8000); // 1.0 秒
    const head = sliceWav(wav, 0, 0.5);
    expect(head).toBeDefined();
    // 0.5 秒 ＝ 4000 サンプル ＝ 8000 バイト。
    const pcm = dataBytes(head!);
    expect(pcm.length).toBe(8000);
    expect(Math.abs(wavDurationSec(head!) - 0.5)).toBeLessThan(1e-6);
    // 先頭サンプル値は 0（元の先頭）。
    const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    expect(v.getUint16(0, true)).toBe(0);
  });

  it('後半の切り出しは開始秒のサンプルから始まる（連続再生の継ぎ目）', () => {
    const wav = makeWav(8000, 8000);
    const tail = sliceWav(wav, 0.5); // [0.5, 末尾)
    expect(tail).toBeDefined();
    const pcm = dataBytes(tail!);
    expect(pcm.length).toBe(8000); // 残り 0.5 秒
    // 開始サンプルは frame 4000（0.5*8000）＝値 4000。
    const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    expect(v.getUint16(0, true)).toBe(4000);
  });

  it('前半＋後半のPCM長を合わせると元と一致（欠落/重複なし＝連続再生）', () => {
    const wav = makeWav(8000, 8000);
    const head = sliceWav(wav, 0, 0.5)!;
    const tail = sliceWav(wav, 0.5)!;
    expect(dataBytes(head).length + dataBytes(tail).length).toBe(8000 * 2);
  });

  it('開始秒が尺以降なら undefined（音声なし）', () => {
    const wav = makeWav(8000, 8000); // 1.0 秒
    expect(sliceWav(wav, 1.0)).toBeUndefined();
    expect(sliceWav(wav, 2.0)).toBeUndefined();
  });

  it('endSec が尺を超えても末尾でクランプ（例外なし）', () => {
    const wav = makeWav(8000, 8000);
    const s = sliceWav(wav, 0.5, 5.0);
    expect(s).toBeDefined();
    expect(dataBytes(s!).length).toBe(8000); // 残り全部
  });

  it('生 base64（data URL でない）入力も受ける', () => {
    const wav = makeWav(8000, 8000);
    const raw = wav.slice(wav.indexOf(',') + 1);
    const s = sliceWav(raw, 0, 0.25);
    expect(s).toBeDefined();
    expect(dataBytes(s!).length).toBe(4000);
  });

  it('壊れた入力は undefined', () => {
    expect(sliceWav('not-a-wav', 0)).toBeUndefined();
    expect(sliceWav('data:audio/wav;base64,AAAA', 0)).toBeUndefined();
  });
});
