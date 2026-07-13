// タイムラインのドラッグ/トリミング時の吸着（ADR-0018 ③(6)）。純粋関数（§7 テスト対象）。
// 1D（時間軸・秒）＝FREE の freeSnap（2D・canvas px）と同系統の考え方を時間軸へ。thresholdSec は秒（呼び出し側で px→秒に換算）。

/**
 * value を targets の最も近い1つへ吸着する（|value − target| ≤ thresholdSec のとき）。範囲内に無ければ value のまま。
 * 複数が範囲内なら最も近い target を選ぶ（同距離は後勝ち・実害なし）。targets 空／threshold≤0 は実質吸着なし。
 */
export function snapTimeSec(value: number, targets: readonly number[], thresholdSec: number): number {
  let best = value;
  let bestDist = thresholdSec;
  for (const t of targets) {
    const d = Math.abs(value - t);
    if (d <= bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}
