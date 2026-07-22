// 重ね順を1段だけ動かす純粋操作の単一の参照元（#210 / #547 P2-4）。§2-7。
//
// 「実効 z」の決め方は対象で違う（FREE 要素＝`zIndex ?? 1`／テンプレ レイヤー＝種別ごとの既定＝`effectiveLayerZ`）が、
// **入れ替えの意味論は同じ**なので、ここに1つだけ置いて z の求め方だけを差し込む。
// 同じ z が並ぶケース（既定値が同じ種別など）の寄せ方まで含めて1か所で決める＝画面ごとに挙動が割れない（ADR-0026②）。

/**
 * `id` の要素を1段だけ前面（'up'）/背面（'down'）へ動かす。
 * 実効 z の昇順で隣と z を入れ替える。端ならそのまま。隣が同じ z のときは移動方向へ寄せて前後を確定する（背面側は 0 が下限）。
 * @param zOf 実効 z の求め方（明示 zIndex が無いときの既定を含む）。
 */
export function moveByZ<T extends { id: string; zIndex?: number }>(
  items: T[],
  id: string,
  direction: "up" | "down",
  zOf: (item: T) => number,
): T[] {
  const sorted = [...items].sort((a, b) => zOf(a) - zOf(b));
  const i = sorted.findIndex((e) => e.id === id);
  if (i < 0) return items;
  const j = direction === "up" ? i + 1 : i - 1;
  if (j < 0 || j >= sorted.length) return items; // 端＝これ以上動かせない
  const a = sorted[i];
  const b = sorted[j];
  const za = zOf(a);
  const zb = zOf(b);
  if (za !== zb) {
    return items.map((e) => (e.id === a.id ? { ...e, zIndex: zb } : e.id === b.id ? { ...e, zIndex: za } : e));
  }
  const nudged = direction === "up" ? zb + 1 : Math.max(0, zb - 1);
  // 背面側が 0 で頭打ちのときは寄せても見た目が変わらない＝**同一参照を返す**。
  // 新しい配列を返すと呼び出し側の同一性ガードをすり抜け、変化していないのに「空の取り消し」が1つ積まれる。
  if (nudged === zb) return items;
  return items.map((e) => (e.id === a.id ? { ...e, zIndex: nudged } : e));
}
