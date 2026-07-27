// 掛け合い再生（仕上がり確認）の「次へ送る」までの窓。純粋関数（§4/§7）＝画面から切り出してテストする
// （`previewAudioVolume` / `previewVideoSlots` と同じ流儀）。
//
// **プレビュー専用**：MP4 は実尺で焼くので、この下限を書き出しへ持ち込まない（ADR-0001／ADR-0026③）。
// 窓の元になるセグメント（`lineSegments`）は書き出しと共有の正準なので、そちらは一切変えない。
import { PREVIEW_MIN_PLAY_SEC } from '../../domain/constants';

/** 窓の計算に要るぶんだけのセグメント（`lineSegments` の戻り値の部分型）。 */
export interface LineWindowSeg {
  startSec: number;
  endSec: number;
}

/**
 * `segs[i]` を再生し始めてから**次へ送る**までの秒数。中間行は次の行へ、最終行は場面送り（advance）。
 *
 * **同じ「送りタイマー」なので下限も同じ**（#608・ADR-0026②）。以前は最終行だけ `PREVIEW_MIN_PLAY_SEC` で
 * 守られ、中間行は素の差分だったため、窓が極端に短い行が**字幕も有効行のハイライトも見えないまま一瞬で飛んで**いた
 * （開始秒を手で詰めた場合＝ADR-0015 の簡易タイミングや、ごく短い音声で起こる）。
 *
 * **同時開始（ADR-0031）だけは窓0のまま**：`startWithPrevious` の行は同じ開始秒を共有し、窓0で連鎖することで
 * 前を止めずに重ねて流す。ここに下限を掛けると2人目が 0.3 秒遅れて**並行でなくなる**ので、`raw <= 0` は素通しする
 * （判定は再生側の `simulWithPrev`＝「開始秒が等しい」と同じ条件）。
 */
export function lineAdvanceWindowSec(segs: LineWindowSeg[], i: number): number {
  const raw = i + 1 < segs.length
    ? segs[i + 1].startSec - segs[i].startSec // 中間行：次の行の開始まで
    : segs[i].endSec - segs[i].startSec; // 最終行：この行の窓の終わり（＝場面末）まで
  return raw <= 0 ? 0 : Math.max(PREVIEW_MIN_PLAY_SEC, raw);
}
