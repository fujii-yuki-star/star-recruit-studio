import { describe, expect, it } from 'vitest';
import { moveByZ, moveToIndexByZ } from './zOrder';

type Item = { id: string; zIndex?: number };
const zOf = (i: Item): number => i.zIndex ?? 0;
/** 昇順（奥→手前）に並べた id の列。 */
const order = (items: Item[]): string[] => [...items].sort((a, b) => zOf(a) - zOf(b)).map((i) => i.id);

describe('moveToIndexByZ（ドラッグで任意の位置へ・#772）', () => {
  const differentZ: Item[] = [
    { id: 'a', zIndex: 10 },
    { id: 'b', zIndex: 20 },
    { id: 'c', zIndex: 30 },
    { id: 'd', zIndex: 40 },
  ];

  it('先頭から末尾へ動かせる', () => {
    expect(order(moveToIndexByZ(differentZ, 'a', 3, zOf))).toEqual(['b', 'c', 'd', 'a']);
  });

  it('末尾から先頭へ動かせる', () => {
    expect(order(moveToIndexByZ(differentZ, 'd', 0, zOf))).toEqual(['d', 'a', 'b', 'c']);
  });

  it('途中から途中へ動かせる', () => {
    expect(order(moveToIndexByZ(differentZ, 'b', 2, zOf))).toEqual(['a', 'c', 'b', 'd']);
  });

  // ⚠️ **同じ位置なら同じ配列を返す**＝取り消しに空の1回を積まない（`moveByZ` と同じ流儀）。
  it('同じ位置への移動は同一参照を返す（空の取り消しを作らない）', () => {
    expect(moveToIndexByZ(differentZ, 'b', 1, zOf)).toBe(differentZ);
  });

  it('範囲の外を指しても端で止まる（落ちない）', () => {
    expect(order(moveToIndexByZ(differentZ, 'a', 99, zOf))).toEqual(['b', 'c', 'd', 'a']);
    expect(order(moveToIndexByZ(differentZ, 'd', -5, zOf))).toEqual(['d', 'a', 'b', 'c']);
  });

  it('居ない id は何もしない（同一参照）', () => {
    expect(moveToIndexByZ(differentZ, 'zzz', 0, zOf)).toBe(differentZ);
  });

  // ⚠️ **同じ z が3つ以上でも1段ずつ動く**＝`moveByZ` の核心（z を ±1 する実装だと同 z の群を
  // まとめて飛び越える）。ドラッグはそれを**繰り返すだけ**なので、この性質をそのまま受け継ぐ。
  it('同じ z が3つ以上並んでいても、指した位置へちょうど入る', () => {
    const sameZ: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]; // 全部 z=0
    expect(order(moveToIndexByZ(sameZ, 'a', 2, zOf))).toEqual(['b', 'c', 'a', 'd']);
    expect(order(moveToIndexByZ(sameZ, 'd', 0, zOf))).toEqual(['d', 'a', 'b', 'c']);
  });

  // ⚠️ **ドラッグ＝↑↓ の繰り返し**であることを直接固定する＝2つの導線で結果が割れない
  //（別実装を置くと、同 z や既定 z の階層またぎで**同じ操作なのに結果が違う**）。
  it('結果は ↑↓ ボタンを繰り返したものと一致する', () => {
    const mixed: Item[] = [{ id: 'a', zIndex: 10 }, { id: 'b' }, { id: 'c' }, { id: 'd', zIndex: 30 }];
    let byButtons = mixed;
    for (let k = 0; k < 2; k += 1) byButtons = moveByZ(byButtons, 'b', 'up', zOf);
    expect(order(moveToIndexByZ(mixed, 'b', order(mixed).indexOf('b') + 2, zOf))).toEqual(order(byButtons));
  });
});
