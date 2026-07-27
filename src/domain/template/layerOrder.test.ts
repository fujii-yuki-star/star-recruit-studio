import { describe, expect, it } from 'vitest';
import type { Layer } from './types';
import { DEFAULT_LAYER_Z, effectiveLayerZ, moveLayerZ } from './layerOrder';

// #547 P2-4：テンプレ作成の「重ね順」一覧の↑↓。基準は**実効 z**＝描画（renderer/layout）と同じ求め方でなければ
// 「一覧で1つ上へ」が実際の重なりと食い違う（zIndex 未指定テンプレで顕在化）。純粋関数＝§7 の必須テスト対象。
const layer = (id: string, type: Layer['type'], zIndex?: number): Layer =>
  ({ id, type, x: 0, y: 0, w: 100, h: 100, ...(zIndex === undefined ? {} : { zIndex }) }) as Layer;

const zs = (layers: Layer[]): Record<string, number> =>
  Object.fromEntries(layers.map((l) => [l.id, effectiveLayerZ(l)]));

/**
 * 実際の重なり順（奥→手前）。実効 z の昇順で**安定**ソート＝同じ z は配列の後ろが手前、という
 * 描画（`renderer/layout` の `items.sort`）・一覧の並びと同じ規則で見る（#587）。
 */
const order = (layers: Layer[]): string[] =>
  [...layers].sort((a, b) => effectiveLayerZ(a) - effectiveLayerZ(b)).map((l) => l.id);

describe('moveLayerZ（テンプレ レイヤーの重ね順を1段動かす・#547 P2-4）', () => {
  it('明示 zIndex どうしは隣と入れ替わる（前面へ）', () => {
    const layers = [layer('a', 'text', 10), layer('b', 'text', 20)];
    const moved = moveLayerZ(layers, 'a', 'up');
    expect(zs(moved)).toEqual({ a: 20, b: 10 }); // 入れ替え
  });

  it('背面へも1段だけ動く', () => {
    const layers = [layer('a', 'text', 10), layer('b', 'text', 20)];
    const moved = moveLayerZ(layers, 'b', 'down');
    expect(zs(moved)).toEqual({ a: 20, b: 10 });
  });

  it('端ではそのまま（これ以上動かせない）', () => {
    const layers = [layer('a', 'text', 10), layer('b', 'text', 20)];
    // 同一参照を返す契約＝呼び出し側の同一性ガードが効き「空の取り消し」を積まない（toEqual では素通りする）。
    expect(moveLayerZ(layers, 'b', 'up')).toBe(layers); // 最前面をさらに前へ
    expect(moveLayerZ(layers, 'a', 'down')).toBe(layers); // 最背面をさらに後ろへ
  });

  // 本命：zIndex 未指定でも「種別ごとの既定順」（＝描画順）で1段動く。
  // `zIndex ?? 0` で並べる実装だと全て同じ 0 とみなされ、一覧の見た目と実際の重なりが 食い違う。
  it('zIndex 未指定でも種別ごとの既定順で動く（描画と同じ基準）', () => {
    const layers = [layer('bg', 'background'), layer('txt', 'text'), layer('logo', 'logo')];
    expect(zs(layers)).toEqual({ bg: DEFAULT_LAYER_Z.background, txt: DEFAULT_LAYER_Z.text, logo: DEFAULT_LAYER_Z.logo });
    // text(30) を前面へ＝logo(60) と入れ替わる（間に character/subtitle は存在しないので隣は logo）。
    const moved = moveLayerZ(layers, 'txt', 'up');
    expect(effectiveLayerZ(moved.find((l) => l.id === 'txt')!)).toBe(DEFAULT_LAYER_Z.logo);
    expect(effectiveLayerZ(moved.find((l) => l.id === 'logo')!)).toBe(DEFAULT_LAYER_Z.text);
    expect(effectiveLayerZ(moved.find((l) => l.id === 'bg')!)).toBe(DEFAULT_LAYER_Z.background); // 無関係は不変
  });

  it('同じ実効 z が並ぶときは配列の順で前後が入れ替わる（z は増やさない）', () => {
    // shape と decor は既定が同じ 20。
    const layers = [layer('s', 'shape'), layer('d', 'decor')];
    const up = moveLayerZ(layers, 's', 'up');
    expect(order(up)).toEqual(['d', 's']); // s が1段前へ
    expect(effectiveLayerZ(up.find((l) => l.id === 's')!)).toBe(DEFAULT_LAYER_Z.shape); // z は据え置き
  });

  // 旧実装は同 z を ±1 で寄せていたため、背面側が 0 だと頭打ちで **↓ が効かなかった**（#587）。
  it('実効 z が 0 どうしでも背面へ動く（0 で頭打ちにならない）', () => {
    const bg2 = [layer('a', 'background'), layer('b', 'background')]; // どちらも 0
    expect(order(bg2)).toEqual(['a', 'b']);
    expect(order(moveLayerZ(bg2, 'b', 'down'))).toEqual(['b', 'a']);
  });

  it('存在しない id は何も変えない', () => {
    const layers = [layer('a', 'text', 10)];
    expect(moveLayerZ(layers, 'nope', 'up')).toBe(layers); // 同一参照
  });
});

// #587：同じ実効 z が3つ以上並ぶと、旧実装（z を +1 して前後を付ける）では**1段**を表現できなかった。
// +1 は同 z のグループ全部を飛び越え、繰り返すと種別ごとの既定 z（10 刻み）の次の階層へ食い込む
// ＝「文字を1つ上げただけなのに立ち絵より前に出る」。
describe('moveLayerZ：同じ実効 z が並んでも1段ずつ動く（#587）', () => {
  it('3つ並んだ真ん中/端でも、動くのはちょうど1段だけ', () => {
    const three = [layer('a', 'text'), layer('b', 'text'), layer('c', 'text')]; // 全部 30
    expect(order(three)).toEqual(['a', 'b', 'c']);
    expect(order(moveLayerZ(three, 'a', 'up'))).toEqual(['b', 'a', 'c']); // 旧実装は ['b','c','a']＝2段飛んだ
    expect(order(moveLayerZ(three, 'c', 'down'))).toEqual(['a', 'c', 'b']);
    // 1段ずつ2回で2段（間を飛ばさない）。
    expect(order(moveLayerZ(moveLayerZ(three, 'a', 'up'), 'a', 'up'))).toEqual(['b', 'c', 'a']);
  });

  it('同種を11個並べて上げ続けても、種別の階層を越えない（文字が立ち絵より前に出ない）', () => {
    const texts = Array.from({ length: 11 }, (_, i) => layer(`t${i}`, 'text')); // 全部 30
    let layers: Layer[] = [...texts, layer('yuko', 'character')]; // 立ち絵は 40
    // 一番後ろの文字を10回上げる＝文字の集団の先頭まで行く。旧実装ではこの時点で z が 40 に達し、立ち絵を追い越していた。
    for (let n = 0; n < 10; n++) layers = moveLayerZ(layers, 't0', 'up');
    expect(order(layers)).toEqual([...texts.slice(1).map((l) => l.id), 't0', 'yuko']);
    expect(effectiveLayerZ(layers.find((l) => l.id === 't0')!)).toBe(DEFAULT_LAYER_Z.text); // z は上がっていない
    // もう1回上げて、ここで初めて立ち絵と入れ替わる（z が違うので z の交換）。
    const crossed = moveLayerZ(layers, 't0', 'up');
    expect(order(crossed).slice(-1)).toEqual(['t0']);
    expect(effectiveLayerZ(crossed.find((l) => l.id === 'yuko')!)).toBe(DEFAULT_LAYER_Z.text);
  });
});
