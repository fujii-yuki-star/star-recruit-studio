// 時間（秒）の表示整形（#411）。純粋関数（副作用なし・テスト容易）。
// 場面尺の合算は浮動小数の誤差で "6.300000000000001秒" のような尾が出るため、表示時は 0.1 秒に丸める。
// 丸めの格子は入力欄の刻み・データの量子化と同じ `SEC_STEP`（§2-7・#561）＝欄の値と表示が食い違わない。
import { quantizeSec } from '../constants';

/** 秒を「X分Y秒／Y秒」表記へ。`SEC_STEP`（0.1秒）に丸める（負値は 0 秒扱い）。合算値の浮動小数の尾を出さない（#411）。 */
export function formatDuration(sec: number): string {
  const rounded = quantizeSec(Math.max(0, sec));
  const m = Math.floor(rounded / 60);
  const s = quantizeSec(rounded - m * 60);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}
