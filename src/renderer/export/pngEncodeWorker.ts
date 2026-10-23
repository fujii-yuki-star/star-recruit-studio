// 書き出しの1コマを PNG にする別スレッド（書き出しの高速化・2026-10-23）。
//
// ⚠️ 画面の主スレッドで `toDataURL` すると、PNG にする手間（実測で主スレッドの約2割）が次のコマを描くのを止める。
//   ここで PNG にすれば、その間に主スレッドは次のコマを描ける。⚠️ 画素はそのまま写す（拡大縮小しない）＝同じ絵。

interface EncodeRequest {
  id: number;
  bitmap: ImageBitmap;
}

self.onmessage = async (e: MessageEvent<EncodeRequest>): Promise<void> => {
  const { id, bitmap } = e.data;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buf = await blob.arrayBuffer();
    (self as unknown as Worker).postMessage({ id, buf }, [buf]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
