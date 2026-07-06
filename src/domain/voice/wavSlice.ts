// WAV(data URL or 生base64) を時間 [startSec, endSec) で切り出す純粋関数（#442・動画スロット本体アニメ）。
// 動画スロットがアニメする場面は「アニメ区間（サムネで全体を焼く Frames セグメント）」と「settled 区間
// （実動画セグメント）」に分割する。1本のナレーションを両区間へ連続再生させるため、フロントで WAV を
// サンプル境界で2つに切り、各セグメントの音声として渡す（Rust 変更不要＝既存 Frames/Video 経路に載る）。
// concat は -c copy で無音を挟まないため、サンプル正確に切れば結合しても連続再生になる（切れ目は不可聴）。

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

interface WavInfo {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  /** data チャンクの本体開始オフセット（バイト）。 */
  dataOffset: number;
  /** data チャンクの本体長（バイト）。 */
  dataSize: number;
}

// RIFF/WAVE のチャンクを走査して fmt と data を得る（wavDurationSec と同方針・境界チェックで不正入力は null）。
function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off: number): string =>
    String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmt: Pick<WavInfo, 'audioFormat' | 'numChannels' | 'sampleRate' | 'bitsPerSample' | 'blockAlign'> | null = null;
  let dataOffset = 0;
  let dataSize = 0;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ' && off + 24 <= bytes.length) {
      fmt = {
        audioFormat: view.getUint16(off + 8, true),
        numChannels: view.getUint16(off + 10, true),
        sampleRate: view.getUint32(off + 12, true),
        blockAlign: view.getUint16(off + 20, true),
        bitsPerSample: view.getUint16(off + 22, true),
      };
    } else if (id === 'data') {
      dataOffset = off + 8;
      dataSize = Math.min(size, bytes.length - dataOffset); // 破損で size 過大でも実バイトで頭打ち
    }
    off += 8 + size + (size % 2); // チャンクは2バイト境界（奇数長はパディング1）
  }
  if (!fmt || dataOffset <= 0 || dataSize <= 0) return null;
  const blockAlign = fmt.blockAlign > 0 ? fmt.blockAlign : (fmt.numChannels * fmt.bitsPerSample) / 8;
  if (blockAlign <= 0) return null;
  return { ...fmt, blockAlign, dataOffset, dataSize };
}

// 秒 → data チャンク内のバイトオフセット（サンプルフレーム境界に丸め・[0,dataSize] にクランプ）。
function secToDataByte(sec: number, info: WavInfo): number {
  const frames = Math.round(Math.max(0, sec) * info.sampleRate);
  const totalFrames = Math.floor(info.dataSize / info.blockAlign);
  const clampedFrames = Math.min(frames, totalFrames);
  return clampedFrames * info.blockAlign;
}

// fmt パラメータ＋切り出した PCM から正準 44 バイトヘッダの WAV を組む（余分なチャンクは落とす＝再生に影響なし）。
function buildWav(info: WavInfo, pcm: Uint8Array): Uint8Array {
  const byteRate = info.sampleRate * info.blockAlign;
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const writeTag = (off: number, s: string): void => {
    for (let i = 0; i < 4; i += 1) out[off + i] = s.charCodeAt(i);
  };
  writeTag(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, info.audioFormat, true);
  view.setUint16(22, info.numChannels, true);
  view.setUint32(24, info.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, info.blockAlign, true);
  view.setUint16(34, info.bitsPerSample, true);
  writeTag(36, 'data');
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/**
 * WAV を時間 [startSec, endSec)（endSec 省略＝末尾まで）で切り出し、data URL を返す。
 * 解析不能・空区間（startSec が尺以降）のときは undefined（呼び出し側で「音声なし」に）。
 * 入力が data URL でも生 base64 でも受け、出力は `data:audio/wav;base64,` の data URL。
 */
export function sliceWav(input: string, startSec: number, endSec?: number): string | undefined {
  const comma = input.indexOf(',');
  const b64 = input.startsWith('data:') && comma >= 0 ? input.slice(comma + 1) : input;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(b64);
  } catch {
    return undefined;
  }
  const info = parseWav(bytes);
  if (!info) return undefined;
  const startByte = secToDataByte(startSec, info);
  const endByte = endSec == null ? info.dataSize : secToDataByte(endSec, info);
  if (endByte <= startByte) return undefined; // 空区間＝音声なし
  const pcm = bytes.subarray(info.dataOffset + startByte, info.dataOffset + endByte);
  return `data:audio/wav;base64,${bytesToBase64(buildWav(info, pcm))}`;
}
