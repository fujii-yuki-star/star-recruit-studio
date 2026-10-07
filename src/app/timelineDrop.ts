// ドラッグで落とした位置を「動画の中の場所」へ翻訳する（#684・ADR-0034 決定2）。
//
// 画面の px と、動画の座標・時刻は別物。**翻訳は純粋関数にしてここへ置く**＝ドラッグ中のゴーストと、
// 離したときに実際に置く場所が**同じ計算**を通る（見えていた所と違う所へ置かれる、を作らない）。

/** 動画の中の点（キャンバス座標）。 */
export type CanvasPoint = { x: number; y: number };

/**
 * 仕上がり確認の中で落とした点を、動画の座標へ翻訳する。
 *
 * 仕上がり確認の枠は **16:9 固定**（CSS）だが、動画は縦型のこともある。SVG は `viewBox` を
 * 既定の `xMidYMid meet` で収めるので、**縦型では左右に余白が入る**＝枠の px をそのまま比で割ると
 * 実際より外側の座標になる。同じ「収め方」でここでも計算する。
 *
 * 枠の外に落ちた場合も**そのまま返す**（枠内へ寄せない）＝置ける／置けないの判定は呼び出し側の仕事。
 */
export function canvasPointAt(
  stage: { left: number; top: number; width: number; height: number },
  canvas: { width: number; height: number },
  clientX: number,
  clientY: number,
): CanvasPoint {
  if (stage.width <= 0 || stage.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    return { x: 0, y: 0 };
  }
  const scale = Math.min(stage.width / canvas.width, stage.height / canvas.height);
  const drawnLeft = stage.left + (stage.width - canvas.width * scale) / 2;
  const drawnTop = stage.top + (stage.height - canvas.height * scale) / 2;
  return { x: (clientX - drawnLeft) / scale, y: (clientY - drawnTop) / scale };
}

/**
 * 列（レーン）の中で落とした点を、その列の時刻へ翻訳する。
 * **横スクロールぶんは要素の位置に含まれている**ので、要素の左端から測ればよい。
 * 0秒より手前へは行かない（負の時刻を作らない）。
 */
export function laneTimeAt(lane: { left: number }, pxPerSec: number, clientX: number): number {
  if (pxPerSec <= 0) return 0;
  return Math.max(0, (clientX - lane.left) / pxPerSec);
}

/** 点が矩形の中か（落とし先を「自分が描いた箱」で当てる＝上に何か重なっていても見失わない）。 */
export function pointInRect(
  r: { left: number; top: number; right: number; bottom: number },
  x: number,
  y: number,
): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** 画面上の矩形（`getBoundingClientRect` と同じ意味）。 */
export type Rect = { left: number; top: number; right: number; bottom: number };
/** 運ぶ・送るの向き（横並びの一覧＝`"x"`／縦積みの列＝`"y"`）。 */
export type DragAxis = "x" | "y";

/**
 * 位置を**見えている範囲へ丸める**（`view` が `null`＝丸めない）。
 * 送る向きのはみ出しは許す設計なので、生の位置で当てると**切り取られて見えていない項目**が
 * 落とし先になり、離すと画面外へ置かれる（#714 項目5・#802-3）。
 *
 * ⚠️ **測れないときは丸めない**＝幅/高さの無い矩形（実寸を持たない環境・まだ描かれていない）で丸めると、
 * すべての位置が端へ潰れて**どこへ運んでも先頭のすき間**になる。丸めは情報がある時だけ効かせる。
 * ⚠️ 運ぶ側（`useDragReorder`）と列の並べ替え（`TimelineProjectScreen`）は**この関数を共有**する
 * ＝同じ規則を2か所に書かない（`06 §12.1`）。
 */
export function clampToVisible(view: Rect | null, pos: number, axis: DragAxis): number {
  const lo = axis === "x" ? view?.left : view?.top;
  const hi = axis === "x" ? view?.right : view?.bottom;
  if (lo == null || hi == null || hi <= lo) return pos;
  return Math.min(hi, Math.max(lo, pos));
}

/** 2つの矩形の重なり（重なりが無ければ `null`）。 */
export function intersectRects(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return right <= left || bottom <= top ? null : { left, top, right, bottom };
}

/**
 * その要素の**実際に見えている範囲**（#684 レビュー）。
 *
 * `getBoundingClientRect` は**スクロールではみ出した分を切らない**ので、そのまま当たり判定に使うと
 * **欄の外へ出て見えていない列**へ落とせてしまう（列は幅の下限があるので必ずはみ出す）。
 * 祖先のうち中身を切っているもの（`overflow` が `visible` でないもの）と順に重ねて、見えている分だけにする。
 * どこにも見えていなければ `null`（＝落とし先にしない）。
 */
export function visibleRectOf(el: Element): Rect | null {
  // まとめて書く `overflow` は、指定が無いと**空文字**で返ることがある（合成プロパティ）。
  // 空を「切っている」と読むと**すべての祖先で切ったことになり、落とし先が消える**。
  const notClipping = (v: string): boolean => v === "" || v === "visible";
  // 返すのは `Rect` だけにする（`DOMRect` をそのまま返すと余分な項目が付いてきて、
  // 呼び出し側の比較やテストが「同じ意味なのに一致しない」になる）。
  const b0 = el.getBoundingClientRect();
  let r: Rect | null = { left: b0.left, top: b0.top, right: b0.right, bottom: b0.bottom };
  for (let p = el.parentElement; p; p = p.parentElement) {
    const st = getComputedStyle(p);
    if (notClipping(st.overflow) && notClipping(st.overflowX) && notClipping(st.overflowY)) continue;
    r = intersectRects(r, p.getBoundingClientRect());
    if (!r) return null;
  }
  return r;
}
