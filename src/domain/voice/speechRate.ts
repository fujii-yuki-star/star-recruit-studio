// 読み上げの速さの見積もり（字/秒）。声の速さ設定とつなぐ（#1318）。純粋関数。
//
// `NARRATION_CHARS_PER_SEC`（11 §4）は**速さ 1.0（ふつう）のとき**の見積もり。VOICEVOX の速さ（`speedScale`）は
// 読み上げの速さの倍率なので、**1秒に読める字数も同じ倍率で増える**（速さ 1.2 なら 1.2 倍）。
// ⚠️ 速さが分からない・0 以下・数でないときは 1.0 として扱う（尺を短く見積もりすぎない側へ倒さない＝従来どおり）。
import { NARRATION_CHARS_PER_SEC } from '../constants';

/** その速さの声が1秒に読める字数の見積もり。 */
export function narrationCharsPerSec(speed?: number | null): number {
  const s = speed != null && Number.isFinite(speed) && speed > 0 ? speed : 1;
  return NARRATION_CHARS_PER_SEC * s;
}
