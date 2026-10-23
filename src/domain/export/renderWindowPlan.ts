// 書き出しのコマを描く窓を、いくつ足すか（ADR-0070 決定4）。
//
// ⚠️ **利用者に選ばせない**＝コアの数と空いているメモリで決める。足すのは**最大2つ**（合計3窓）。
//   試作（最低検証機）で2窓 約1.68倍・3窓 約2.06倍。それより増やすと、窓1つあたりが遅くなるぶんで伸びが細る。
// ⚠️ **空きが分からなければ足さない**（いままでどおり1窓）＝分からないまま足して、メモリが尽きる方が悪い。

/** 足す窓の上限。 */
export const RENDER_WINDOW_MAX_EXTRA = 2;
/**
 * 窓1つが書き出しの間に使う見込み（実測 2026-10-23・20秒の動画を3窓で書き出し）＝描く窓の描画プロセスが最大 約470MB、
 * 窓どうしで分け合う GPU の処理が 約750MB（1窓のときの約260MBから増えた分を窓の数で割ると約250MB）。合わせて丸めた値。
 */
export const RENDER_WINDOW_BYTES = 600 * 1024 * 1024;
/**
 * 窓を足しても残しておく空き（書き出しの本体・FFmpeg・ほかのアプリのぶん）。
 * ⚠️ 2GB にすると、最低検証機（16GB）で普段使いのアプリが開いていると空きが 2.2GB 前後で、**窓が1つも足せなかった**（実測）。
 */
export const RENDER_WINDOW_RESERVE_BYTES = 1 * 1024 * 1024 * 1024;

/** 足す窓の数（0〜`RENDER_WINDOW_MAX_EXTRA`）。 */
export function extraRenderWindows(input: { logicalCores: number | undefined; availableBytes: number | null | undefined }): number {
  const cores = input.logicalCores ?? 0;
  const avail = input.availableBytes;
  if (avail == null || !Number.isFinite(avail)) return 0;
  // コアが少ないと、窓を足しても主スレッドどうしが取り合うだけ（本体＋窓で同時に描くのは2つまで）。
  const byCores = cores >= 8 ? RENDER_WINDOW_MAX_EXTRA : cores >= 4 ? 1 : 0;
  const byMemory = Math.floor((avail - RENDER_WINDOW_RESERVE_BYTES) / RENDER_WINDOW_BYTES);
  return Math.max(0, Math.min(byCores, byMemory, RENDER_WINDOW_MAX_EXTRA));
}
