/** コマの速さ（分数）。 */
export interface Fps {
  num: number;
  den: number;
}

/**
 * コマ番号 → タイムコード「時:分:秒:コマ」（ドロップしない数え方）。
 * ⚠️ 29.97 などは、1秒のコマ数を四捨五入した値（30）で数える＝AE の既定（NDF）と同じ。
 */
export function formatTimecode(frame: number, fps: Fps): string {
  const base = Math.max(1, Math.round(fps.num / fps.den));
  const f = Math.max(0, Math.floor(frame));
  const ff = f % base;
  const totalSec = Math.floor(f / base);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(hh)}:${two(mm)}:${two(ss)}:${two(ff)}`;
}

/** fps の表示（30000/1001 → 29.97）。 */
export function formatFps(fps: Fps): string {
  const v = fps.num / fps.den;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
