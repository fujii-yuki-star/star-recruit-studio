// 掴んだまま**画面の端まで来たら送る**（#714-1・ADR-0034 決定9）。
//
// これが無いと「いま見えている時間帯にしか置けない」＝倍率を上げるほど窮屈になる
// （120px/秒では画面の幅で十数秒しか運べない）。運べないと**掴む操作そのものが使い物にならない**。
//
// 速さの決め方だけをここに置く（純粋）。実際に送るのは `useEdgeAutoScroll`＝時計と要素は app 層。

/** 端から何 px を「送る帯」とみなすか。 */
export const EDGE_ZONE_PX = 48;
/** いちばん端での速さ（px/秒）。奥へ入るほどこれに近づく。 */
export const EDGE_MAX_PX_PER_SEC = 900;

/**
 * その指の位置で **1秒あたり何 px 送るか**（右が正・0＝送らない）。
 *
 * - 端から `zonePx` の内側だけで効く。**深いほど速い**（線形）＝端に貼り付けなくても少しずつ動く。
 * - **枠の外に出ても最大のまま**（`clamp`）＝窓の外まで指を出したときに速さが跳ねたり止まったりしない。
 * - 幅が帯2つ分に満たないときは効かせない＝左右の帯が重なって、真ん中でも勝手に動く状態を作らない。
 */
export function edgeScrollPxPerSec(input: {
  /** 指の位置（枠の左端からの px）。 */
  pointerPx: number;
  /** 枠の幅（px）。 */
  viewPx: number;
  /**
   * 左側の「中身が見えない幅」（列の名前の欄・#714 レビュー）。
   * ⚠️ 0 のままだと**送る帯が名前の欄の下に丸ごと隠れる**（帯 48px＜欄 84px）＝左へ送っている間、
   * 指の下は常に名前の欄なので**どこへ入るかを見ながら送れず**、そのまま離すと見えない時刻に置かれる。
   */
  insetLeftPx?: number;
  zonePx?: number;
  maxPxPerSec?: number;
}): number {
  const zone = input.zonePx ?? EDGE_ZONE_PX;
  const max = input.maxPxPerSec ?? EDGE_MAX_PX_PER_SEC;
  const inset = input.insetLeftPx ?? 0;
  if (input.viewPx - inset < zone * 2) return 0;
  const depthLeft = inset + zone - input.pointerPx;
  if (depthLeft > 0) return -max * Math.min(1, depthLeft / zone);
  const depthRight = input.pointerPx - (input.viewPx - zone);
  if (depthRight > 0) return max * Math.min(1, depthRight / zone);
  return 0;
}

/**
 * 送った結果のスクロール位置（**行き止まりで止まる**）。
 * 端に着いたら `from` と同じ値を返すので、呼び出し側は「これ以上動かない」を同一値で判る。
 */
export function nextScrollLeft(from: number, deltaPx: number, maxScrollLeft: number): number {
  return Math.max(0, Math.min(maxScrollLeft, from + deltaPx));
}
