// 重ね順を1段だけ動かす純粋操作の単一の参照元（#210 / #547 P2-4）。§2-7。
//
// 「実効 z」の決め方は対象で違う（FREE 要素＝`zIndex ?? 1`／テンプレ レイヤー＝種別ごとの既定＝`effectiveLayerZ`）が、
// **入れ替えの意味論は同じ**なので、ここに1つだけ置いて z の求め方だけを差し込む。
// 同じ z が並ぶケース（既定値が同じ種別など）の寄せ方まで含めて1か所で決める＝画面ごとに挙動が割れない（ADR-0026②）。

/**
 * `id` の要素を1段だけ前面（'up'）/背面（'down'）へ動かす。実効 z の昇順（**安定**）で隣と入れ替える。端ならそのまま。
 *
 * 隣と z が違えば z を入れ替える。**同じ z のときは配列上で入れ替える**（z は触らない）＝重なりの前後は
 * 「実効 z の昇順、同じなら配列の後ろが手前」で決まっており（描画 `layout.ts` も一覧の並びも同じ安定ソート）、
 * 同 z の中での前後は**配列の順そのもの**だから。
 *
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
  // 同じ z ＝並び順は配列が決めているので、配列上で隣と入れ替えれば**ちょうど1段**動く（#587）。
  //
  // 旧実装は z を ±1 して前後を付けていたが、整数の z では**3つ以上が同じ z のとき1段を表現できない**：
  // +1 すると同 z のグループ**全部**を飛び越えてしまう（1段のつもりが数段動く）。さらに繰り返すと、
  // 種別ごとの既定 z（`DEFAULT_LAYER_Z`＝10刻み）の**次の階層へ食い込む**＝「文字を1つ上げただけなのに
  // 立ち絵より前に出る」。背面側も 0 で頭打ちになり、z=0 が2つ並ぶと ↓ が効かなかった。
  // 配列の入れ替えなら z を増やさないので、どちらも構造的に起きない。
  const next = [...items];
  const ia = next.findIndex((e) => e.id === a.id);
  const ib = next.findIndex((e) => e.id === b.id);
  [next[ia], next[ib]] = [next[ib], next[ia]];
  return next;
}
