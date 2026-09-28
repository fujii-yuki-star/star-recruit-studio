// 画面を切り出して撮るときの範囲（`gdigrab`）。
//
// ⚠️ **切り出し位置は「仮想デスクトップの絶対座標」**（2026-09-28 に実測して直した）＝
// `-offset_x/-offset_y` は**原点を引かない**。以前ここで
// 「原点（`GetSystemMetrics(76/77)`）ぶんを引く」と書いていたが、**それが誤り**だった：
// 画面を**左に並べた**環境（原点 `-1920`）で 52 を渡すべきところに 1972 が渡り、
// FFmpeg が `Capture area (1972,52),(3268,890) extends outside window area (-1920,0),(1920,1158)`
// で即終了した（＝「録画が始まってすぐに止まりました」）。原点が (0,0) の環境では
// 引いても同じ値になるので、**そこでは緑に見えていた**。
// 実測：原点 (-1920,0)・大きさ 3840x1158 の環境で、窓 1296x838 @ (52,52) を
// `-offset_x 52 -offset_y 52` で撮ると**窓だけが正しく写る**（`abs.png` で確認）。

/**
 * 撮る範囲を `gdigrab` の引数にする。**画面の外にはみ出していたら、撮る前に断る**。
 *
 * ⚠️ **FFmpeg のメッセージのまま出さない**（§2-5）＝英語で座標だけ並ぶので、
 * 読んだ人が**次に何をすればよいか**が分からない。ここで日本語にして行動を書く。
 *
 * @param {{ x: number, y: number, w: number, h: number }} rect 撮る範囲（仮想デスクトップの絶対座標）
 * @param {{ x: number, y: number, w: number, h: number }} screen 仮想デスクトップ（左上と大きさ）
 * @returns {string[]} FFmpeg の引数
 */
export function gdigrabArea(rect, screen) {
  if (!(rect.w > 0 && rect.h > 0)) {
    throw new Error(`撮る範囲の大きさが 0 です（${rect.w}x${rect.h}）。窓を開いてから撮ってください。`);
  }
  const outsides = [];
  if (rect.x < screen.x) outsides.push("左");
  if (rect.y < screen.y) outsides.push("上");
  if (rect.x + rect.w > screen.x + screen.w) outsides.push("右");
  if (rect.y + rect.h > screen.y + screen.h) outsides.push("下");
  if (outsides.length > 0) {
    throw new Error(
      `撮る範囲が画面の${outsides.join("・")}へはみ出しています`
      + `（撮る範囲 ${rect.w}x${rect.h} @ (${rect.x},${rect.y})／画面 ${screen.w}x${screen.h} @ (${screen.x},${screen.y})）。`
      + `アプリの窓を画面の中へ動かしてから、もう一度撮ってください。`,
    );
  }
  // ⚠️ **引かない**（上の注記）＝ここが今回の直し。
  return ["-offset_x", String(rect.x), "-offset_y", String(rect.y), "-video_size", `${rect.w}x${rect.h}`];
}
