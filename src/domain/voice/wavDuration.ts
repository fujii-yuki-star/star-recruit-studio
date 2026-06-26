// WAV(data URL or 生base64) のおおよその尺（秒）をヘッダから求める（ADR-0015 PR-E・掛け合いの行音声の長さ測定）。
// 純粋関数（副作用なし）。fmt チャンクの byteRate と data チャンク長から尺＝dataSize/byteRate を出す。
// 解析できない・0 のときは 0 を返す（呼び出し側＝lineSegments の自動逐次フォールバックに使う）。

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** WAV(data URL or 生base64) の尺（秒）。ヘッダ不正・byteRate/dataSize が 0 のときは 0。 */
export function wavDurationSec(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(b64);
  } catch {
    return 0;
  }
  if (bytes.length < 44) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off: number): string =>
    String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return 0;
  // 12 から チャンク（id4＋size4＋data）を走査し、fmt の byteRate と data の長さを得る。
  let byteRate = 0;
  let dataSize = 0;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ' && off + 20 <= bytes.length) {
      // fmt データ: audioFormat(2)/numChannels(2)/sampleRate(4)/byteRate(4)… → byteRate は chunk 先頭+16。
      // 末尾で fmt が切れた WAV でも getUint32 が範囲外で throw しないよう境界を確認する（不正入力は 0）。
      byteRate = view.getUint32(off + 16, true);
    } else if (id === 'data') {
      dataSize = size;
    }
    off += 8 + size + (size % 2); // チャンクは2バイト境界（奇数長はパディング1）。
  }
  if (byteRate <= 0 || dataSize <= 0) return 0;
  return dataSize / byteRate;
}
