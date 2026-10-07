// 掴んだまま**画面の端まで来たら送る**（#714-1・ADR-0034 決定9）。
//
// ⚠️ **向きを問わない**（#714 項目5）＝タイムライン（横）だけでなく、並べ替え（場面カードの帯＝横・
// 台本表の頁＝縦）でも同じ規則を通す。だから語彙は「左右」ではなく**送る向きの始点・長さ**で書く。
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
 * その指の位置で **1秒あたり何 px 送るか**（**送る向きに進むほうが正**・0＝送らない）。
 *
 * - 端から `zonePx` の内側だけで効く。**深いほど速い**（線形）＝端に貼り付けなくても少しずつ動く。
 * - **枠の外に出ても最大のまま**（`clamp`）＝窓の外まで指を出したときに速さが跳ねたり止まったりしない。
 * - 幅が帯2つ分に満たないときは効かせない＝左右の帯が重なって、真ん中でも勝手に動く状態を作らない。
 */
export function edgeScrollPxPerSec(input: {
  /** 指の位置（**枠の始点**からの px＝横なら左端・縦なら上端）。 */
  pointerPx: number;
  /** 枠の**送る向きの長さ**（px＝横なら幅・縦なら高さ）。 */
  viewPx: number;
  /**
   * **始点側**の「中身が見えない幅」（列の名前の欄・#714 レビュー）。
   * ⚠️ 0 のままだと**送る帯が名前の欄の下に丸ごと隠れる**（帯 48px＜欄 84px）＝左へ送っている間、
   * 指の下は常に名前の欄なので**どこへ入るかを見ながら送れず**、そのまま離すと見えない時刻に置かれる。
   */
  insetStartPx?: number;
  zonePx?: number;
  maxPxPerSec?: number;
}): number {
  const zone = input.zonePx ?? EDGE_ZONE_PX;
  const max = input.maxPxPerSec ?? EDGE_MAX_PX_PER_SEC;
  const inset = input.insetStartPx ?? 0;
  if (input.viewPx - inset < zone * 2) return 0;
  const depthStart = inset + zone - input.pointerPx;
  if (depthStart > 0) return -max * Math.min(1, depthStart / zone);
  const depthEnd = input.pointerPx - (input.viewPx - zone);
  if (depthEnd > 0) return max * Math.min(1, depthEnd / zone);
  return 0;
}

/**
 * 送った結果のスクロール位置（**行き止まりで止まる**・向きを問わない）。
 * 端に着いたら `from` と同じ値を返すので、呼び出し側は「これ以上動かない」を同一値で判る。
 */
export function nextScrollPos(from: number, deltaPx: number, maxScrollPx: number): number {
  return Math.max(0, Math.min(maxScrollPx, from + deltaPx));
}

/**
 * **再生に合わせて見える範囲を送る**（#819-1・ページ送り）。次のスクロール位置（`null`＝送らない）。
 *
 * ⚠️ **常に追わない**（滑らせない）＝再生ヘッドが見えている間は動かさず、**枠の外へ出たときだけ**
 * 送る。毎フレーム中央へ寄せると、画面全体が流れ続けて**帯の位置関係が読めない**（業界の型も
 * ページ送りが基本）。
 * ⚠️ **送った先はヘッドが左端**＝続きがいちばん長く見える（右端に置くと次の瞬間また送ることになる）。
 * ⚠️ **戻る向きにも効く**（シークで前へ跳んだとき）＝前に戻したのに画面だけ先のままにしない。
 * 行き止まりでは動かない（`nextScrollPos` と同じ考え方）。
 */
export function playbackScrollLeft(input: {
  /** いまのスクロール位置（px）。 */
  scrollLeft: number;
  /** 見えている幅（px）。 */
  viewPx: number;
  /** 中身の全幅（px）。 */
  contentPx: number;
  /** 再生ヘッドの位置（px・中身の左端から）。 */
  headPx: number;
  /** 左端に固定されている列名の幅（px）＝そのぶんは見えていない。 */
  insetStartPx?: number;
}): number | null {
  const inset = input.insetStartPx ?? 0;
  const visibleFrom = input.scrollLeft;
  const visibleTo = input.scrollLeft + Math.max(0, input.viewPx - inset);
  if (input.headPx >= visibleFrom && input.headPx <= visibleTo) return null; // 見えている＝動かさない
  const maxScroll = Math.max(0, input.contentPx - Math.max(0, input.viewPx - inset));
  const next = Math.max(0, Math.min(maxScroll, input.headPx));
  return next === input.scrollLeft ? null : next; // 行き止まり＝これ以上動かない
}
