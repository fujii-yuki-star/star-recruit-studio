// 書き出しのコマを描く窓を、いくつ足すか（ADR-0070 決定4・追補 2026-11-04）。
//
// ⚠️ **利用者に選ばせない**＝コアの数と積んでいるメモリで決める。足すのは**最大2つ**（合計3窓）。
//   試作（最低検証機）で2窓 約1.68倍・3窓 約2.06倍。それより増やすと、窓1つあたりが遅くなるぶんで伸びが細る。
// ⚠️ **「いま空いている物理メモリ」では決めない**（追補 2026-11-04）＝最低検証機（16GB）は普段使いのアプリで空きが
//   0.6〜1.7GB しかなく、その値で決めると**窓がほぼ一度も足されなかった**。ところが空きが 1.5GB 前後の状態でも、窓を
//   2つ足した方が**速かった**（20秒の動画 119→59 秒・講座 425→382 秒・md5 は全部一致）＝Windows は使われていない
//   メモリを退かせて場所を作る。だから**積んでいるメモリ**で数を決め、**まだ確保できる余地（ページファイル込み）**で
//   尽きないことだけを確かめる。
// ⚠️ **分からなければ足さない**（いままでどおり1窓）＝分からないまま足して、メモリが尽きる方が悪い。

/** 足す窓の上限。 */
export const RENDER_WINDOW_MAX_EXTRA = 2;
/**
 * 窓1つが書き出しの間に使う見込み（実測 2026-10-23・20秒の動画を3窓で書き出し）＝描く窓の描画プロセスが最大 約470MB、
 * 窓どうしで分け合う GPU の処理が 約750MB（1窓のときの約260MBから増えた分を窓の数で割ると約250MB）。合わせて丸めた値。
 */
export const RENDER_WINDOW_BYTES = 600 * 1024 * 1024;
/** まだ確保できる余地（ページファイル込み）から、窓を足しても残しておく分（書き出しの本体・FFmpeg・ほかのアプリ）。 */
export const RENDER_WINDOW_COMMIT_RESERVE_BYTES = 1 * 1024 * 1024 * 1024;
/** 窓を2つ足す、積んでいるメモリの下限。 */
export const RENDER_WINDOW_TWO_MIN_TOTAL_BYTES = 12 * 1024 * 1024 * 1024;
/** 窓を1つ足す、積んでいるメモリの下限。 */
export const RENDER_WINDOW_ONE_MIN_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;

/** メモリの様子（Rust の `memory_status`）。 */
export interface MemoryStatus {
  totalPhys: number;
  availPhys: number;
  availCommit: number;
}

/** 足す窓の数（0〜`RENDER_WINDOW_MAX_EXTRA`）。 */
export function extraRenderWindows(input: { logicalCores: number | undefined; memory: MemoryStatus | null | undefined }): number {
  const cores = input.logicalCores ?? 0;
  const m = input.memory;
  if (!m || !Number.isFinite(m.totalPhys) || !Number.isFinite(m.availCommit)) return 0;
  // コアが少ないと、窓を足しても主スレッドどうしが取り合うだけ（本体＋窓で同時に描くのは2つまで）。
  const byCores = cores >= 8 ? RENDER_WINDOW_MAX_EXTRA : cores >= 4 ? 1 : 0;
  const byTotal = m.totalPhys >= RENDER_WINDOW_TWO_MIN_TOTAL_BYTES ? 2 : m.totalPhys >= RENDER_WINDOW_ONE_MIN_TOTAL_BYTES ? 1 : 0;
  // ⚠️ **尽きないことだけ確かめる**＝確保できる余地が窓のぶんに足りなければ減らす（足りないまま足すと確保に失敗する）。
  const byCommit = Math.floor((m.availCommit - RENDER_WINDOW_COMMIT_RESERVE_BYTES) / RENDER_WINDOW_BYTES);
  return Math.max(0, Math.min(byCores, byTotal, byCommit, RENDER_WINDOW_MAX_EXTRA));
}
