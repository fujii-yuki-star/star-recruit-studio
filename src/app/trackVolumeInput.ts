// 列の音量をその場で直す欄（ADR-0067）の値の読み方。計算だけ（画面は当てるだけ）。

/**
 * 欄に打った「%」の数を列の音量（倍率）へ。**空・読めない値は `null`**＝標準（100%）へ戻す
 *（`setTrackVolume` が値域へ収める・100% はキーを消す）。
 */
export function trackVolumeFromPercentText(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n / 100 : null;
}
