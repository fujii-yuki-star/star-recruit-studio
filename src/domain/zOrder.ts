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

/**
 * 重ね順の中で、ある要素を**任意の位置へ**動かす（ドラッグでの並び替え・#772 候補3）。
 *
 * ⚠️ **`moveByZ`（1段）を繰り返すだけ**にする＝ドラッグと ↑↓ ボタンで**意味が割れない**。
 * z を直接書き換える別実装を置くと、同じ z が3つ以上あるとき・種別ごとの既定 z（10刻み）を
 * またぐときの扱いが2通りになり、**同じ操作なのに結果が違う**（`moveByZ` のコメントにある
 * 「1段のつもりが数段動く」を、ドラッグ側だけがもう一度踏む）。
 *
 * `targetIndex` は**昇順（奥→手前）に並べたときの位置**。画面が「上＝手前」で見せているなら、
 * 呼び出し側で反転してから渡す（並びの向きは画面の都合で、ここは持たない）。
 */
export function moveToIndexByZ<T extends { id: string; zIndex?: number }>(
  items: T[],
  id: string,
  targetIndex: number,
  zOf: (item: T) => number,
): T[] {
  const sorted = [...items].sort((a, b) => zOf(a) - zOf(b));
  const from = sorted.findIndex((e) => e.id === id);
  if (from < 0) return items;
  // ⚠️ **範囲へ収めるのは繰り返しの回数を抑えるため**＝収めても収めなくても**結果は同じ**
  //（端に着いた後の `moveByZ` は同じ配列を返すだけ）。つまり**変異チェックでは捕まらない行**なので、
  // 「テストが守っている」とは書かない。収めないと、桁の大きい値を渡されたときに**無駄な繰り返し**が走る。
  const to = Math.max(0, Math.min(sorted.length - 1, targetIndex));
  if (to === from) return items; // 動かない＝同じ配列を返す（空の取り消しを積まない）
  // 収めた後は**必ず届く**ので、途中で止まる分岐は要らない（置くと**到達しない行**になる＝
  // 「端に着いた」というコメントが嘘になる。最初そう書いて変異チェックで気づいた）。
  const direction = to > from ? 'up' : 'down';
  let cur = items;
  for (let step = 0; step < Math.abs(to - from); step += 1) {
    cur = moveByZ(cur, id, direction, zOf);
  }
  return cur;
}
