// タイムライン編集の表示倍率（#686 段階2・ADR-0034 決定13）。純粋関数（§4・§7）。
//
// **段階は場面形式の見わたす画面と同じ型**（決定13）＝同じ概念を画面ごとに別の刻みにしない。
// 覚えない（決定14＝文書の中身に依存する状態は覚えない）ので、開くたびに「全体表示」から始める。
import { TIMELINE_ZOOM_LEVELS } from '../constants';

/** 表示倍率の段（px/秒）。小さいほど広い範囲が見える。 */
export const ZOOM_LEVELS = TIMELINE_ZOOM_LEVELS;

/**
 * **全体が収まる段**を選ぶ（開いた直後の既定・決定13「開いた直後は全体表示」）。
 *
 * 収まる段のうち**いちばん大きい**もの＝ぎりぎり全部見える所から始める。どの段でも収まらない
 * （長い動画）ときは**いちばん小さい段**（それ以上は広げられない＝横スクロールで見る）。
 * 尺が 0（何も置いていない）は既定の段＝目盛りが潰れない。
 */
export function fitZoomIndex(totalSec: number, viewportPx: number): number {
  if (!(totalSec > 0) || !(viewportPx > 0)) return DEFAULT_ZOOM_INDEX;
  for (let i = ZOOM_LEVELS.length - 1; i >= 0; i -= 1) {
    if (totalSec * ZOOM_LEVELS[i] <= viewportPx) return i;
  }
  return 0;
}

/** 何も置いていないときの段（`fitZoomIndex` が尺を測れないときの受け皿）。 */
export const DEFAULT_ZOOM_INDEX = 2;

/** 段を1つ動かす（範囲外へは出ない＝押せるのに何も起きない、を作らない側の材料）。 */
export function stepZoomIndex(index: number, delta: number): number {
  return Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index + delta));
}

/**
 * **錨点を保ったまま**倍率を変えたときの、新しいスクロール位置（決定13「錨点はマウス位置」）。
 *
 * 錨点＝画面の中で動かしたくない点（マウスの位置）。そこにある時刻が同じ場所に留まるように、
 * スクロール位置をずらす。これが無いと、拡大するたびに見ていた所が画面の外へ流れていく。
 */
export function zoomScrollLeft(input: {
  scrollLeft: number;
  anchorPx: number; // 画面（スクロールする箱）の左端から錨点までの px
  labelPx: number; // 列の名前の欄の幅＝時間 0 の位置は content の `labelPx` から始まる
  fromPxPerSec: number;
  toPxPerSec: number;
}): number {
  // ⚠️ **列の名前の欄ぶんを引く**（#686 レビュー）。中身は［名前の欄］［時間の並び］の順なので、
  // 時刻 t の content 座標は `labelPx + t×倍率`。引かないと錨点が `labelPx×(1 − to/from)` px 流れる
  // （36→54 で 42px＝0.78秒）。`fitZoomIndex` は引いているのに、ここだけ落ちていた。
  // 名前の欄は貼り付いていて常に見えているので、その上を指しているときは**中身の左端**を錨点にする
  // （そこには時刻が無い＝引くと負の時刻になり、意味の無い位置へ飛ぶ）。
  const anchor = Math.max(input.anchorPx, input.labelPx);
  const anchorSec = Math.max(0, (input.scrollLeft + anchor - input.labelPx) / input.fromPxPerSec);
  return Math.max(0, input.labelPx + anchorSec * input.toPxPerSec - anchor);
}

/**
 * 目盛りの間隔（秒）。**倍率で決める**（#686 レビュー）＝尺で決めると、倍率を変えたときに
 * 目盛りが潰れる／消える（最小段で 1秒＝16px 間隔に文字が重なる・最大段で 30秒＝3600px に1本）。
 * 場面形式の見わたす画面と**同じ関数**を読む（同名の規則を2つ持たない）。
 */
export function tickStepSec(pxPerSec: number): number {
  // **読める間隔になる最小の刻み**を選ぶ＝必要以上に粗くしない（粗すぎると目印が消える。
  // 20秒の動画で 30秒刻みにすると「0秒」しか出ない）。
  for (const step of TICK_STEPS_SEC) if (step * pxPerSec >= TICK_MIN_GAP_PX) return step;
  return TICK_STEPS_SEC[TICK_STEPS_SEC.length - 1];
}

/** 目盛りの刻みの候補（秒）。時計として読める値だけ＝3秒や7秒のような半端を出さない。 */
const TICK_STEPS_SEC = [1, 2, 5, 10, 15, 30, 60] as const;
/** 目盛りの文字が重ならない最小の間隔（px）。 */
const TICK_MIN_GAP_PX = 40;
