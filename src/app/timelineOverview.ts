// タイムラインの全体図の帯（#1319 c2）＝全体を細い帯に縮め、いま見えている範囲を枠で示す。
// 計算だけをここに置く（画面は描くだけ）。型は Resolve のカットページの上のタイムライン・Premiere の横スクロール。

/** 見えている時間の範囲（秒）。 */
export interface OverviewViewport {
  startSec: number;
  endSec: number;
}

/**
 * 並びの枠の送り量から、**見えている時間の範囲**を出す。
 *
 * ⚠️ **列の名前の欄は左に貼り付いている**（`position: sticky`）＝送っても名前の欄の幅ぶんは帯が見えない。
 *   見えている帯は「送り量」から「送り量＋枠の幅−名前の欄」まで（帯の 0 秒は名前の欄のすぐ右）。
 */
export function overviewViewport(
  scrollLeft: number,
  clientWidth: number,
  labelPx: number,
  pxPerSec: number,
  totalSec: number,
): OverviewViewport {
  if (pxPerSec <= 0 || totalSec <= 0) return { startSec: 0, endSec: 0 };
  const startSec = Math.min(totalSec, Math.max(0, scrollLeft / pxPerSec));
  const endSec = Math.min(totalSec, Math.max(startSec, (scrollLeft + clientWidth - labelPx) / pxPerSec));
  return { startSec, endSec };
}

/** 全体図を出すか＝**全体が枠に収まっていれば出さない**（送る先が無い・同じものを2つ並べるだけ）。 */
export function overviewNeeded(view: OverviewViewport, totalSec: number): boolean {
  return totalSec > 0 && view.endSec - view.startSec < totalSec - 1e-6;
}

/** その時刻が**真ん中に来る**送り量（押した所へ送る）。枠の外へは送らない（0〜最大）。 */
export function scrollLeftCenteredAt(
  sec: number,
  clientWidth: number,
  labelPx: number,
  pxPerSec: number,
  maxScrollLeft: number,
): number {
  const visiblePx = Math.max(0, clientWidth - labelPx);
  return Math.min(Math.max(0, maxScrollLeft), Math.max(0, sec * pxPerSec - visiblePx / 2));
}
