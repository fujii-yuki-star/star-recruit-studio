// 掴んで並べ替えるときの**位置の計算**（純粋・副作用なし）。画面をまたいで同じ式を見る（#771(c)）。
//
// ⚠️ **「どの項目に重なったか」で置き場所を決めない**＝同じ手つきが向きで別の意味になる。
// 配列から抜いてから入れる（`splice`）ので、前へ動かすときは「その項目の**手前**」、後ろへ動かす
// ときは「その項目の**後ろ**」に入る＝**利用者は同じ操作をしたのに結果が1つずれる**。
// 落とし先は**すき間**（項目と項目の間）で決め、挿入線でそれを見せる。

/**
 * 表示上の**すき間**（0〜n）を、`splice` で入れる位置へ直す。
 *
 * すき間は「元の並びのどこへ差し込むか」＝0 が先頭の手前、n が末尾の後ろ。
 * ⚠️ **抜いた場所より後ろへ入れるときは1つ手前へずれる**（抜いてから入れるため）。
 * ここを間違えると「1つ隣に落ちる」になり、しかも**向きによってだけ**ずれるので気づきにくい。
 *
 * @param gap 表示上のすき間（0〜n）
 * @param from 動かすものが**いま居る位置**（配列の添字）
 */
export function insertIndexForGap(gap: number, from: number): number {
  return gap > from ? gap - 1 : gap;
}

/** 並びの1項目が占める範囲（軸に沿った開始と終わり・px）。 */
export interface ItemBounds {
  start: number;
  end: number;
}

/**
 * その位置が指す**すき間**（#714 項目5）。`null`＝どの項目にも当たらず決められない（いまの線を保つ）。
 *
 * ⚠️ **必要になった理由**＝端まで運んで送っている間、**指は止まったまま**なので落とし先の要素から
 * `pointermove` が来ない。送った分だけ並びは動くのに線は止まったままになり、離すと**送る前の場所**へ
 * 落ちる。位置から引き直せるようにして、送っている間も線が追いつくようにする。
 *
 * 規則は要素の上で測るときと同じ＝**半分より手前ならその手前のすき間・後ろなら後ろのすき間**（#771(c)）。
 * ⚠️ **大きさが取れない項目（0px）は当たりにしない**＝実寸を持たない環境で、並びの先頭に総取りされない。
 */
export function gapAtPosition(items: readonly ItemBounds[], pos: number): number | null {
  const sized = items.filter((it) => it.end > it.start);
  if (sized.length === 0) return null;
  // 並びの外＝端のすき間（送っている最中に窓の外へ出ても、線が消えない）。
  if (pos < sized[0].start) return 0;
  if (pos > sized[sized.length - 1].end) return items.length;
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (it.end <= it.start) continue;
    if (pos < it.start || pos > it.end) continue;
    return pos >= it.start + (it.end - it.start) / 2 ? i + 1 : i;
  }
  return null; // 項目と項目の間（余白）に居る＝どちらとも決めない
}
