import { describe, expect, it } from 'vitest';
import type { Layer } from './types';
import { DEFAULT_LAYER_Z, effectiveLayerZ, moveLayerZ } from './layerOrder';

// #547 P2-4：テンプレ作成の「重ね順」一覧の↑↓。基準は**実効 z**＝描画（renderer/layout）と同じ求め方でなければ
// 「一覧で1つ上へ」が実際の重なりと食い違う（zIndex 未指定テンプレで顕在化）。純粋関数＝§7 の必須テスト対象。
const layer = (id: string, type: Layer['type'], zIndex?: number): Layer =>
  ({ id, type, x: 0, y: 0, w: 100, h: 100, ...(zIndex === undefined ? {} : { zIndex }) }) as Layer;

const zs = (layers: Layer[]): Record<string, number> =>
  Object.fromEntries(layers.map((l) => [l.id, effectiveLayerZ(l)]));

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

  it('同じ実効 z が並ぶときは移動方向へ寄せて前後を確定する（背面側は 0 が下限）', () => {
    // shape と decor は既定が同じ 20。
    const layers = [layer('s', 'shape'), layer('d', 'decor')];
    const up = moveLayerZ(layers, 's', 'up');
    expect(effectiveLayerZ(up.find((l) => l.id === 's')!)).toBe(DEFAULT_LAYER_Z.decor + 1); // 前へ寄る

    const bg2 = [layer('a', 'background'), layer('b', 'background')]; // どちらも 0
    const down = moveLayerZ(bg2, 'b', 'down');
    expect(effectiveLayerZ(down.find((l) => l.id === 'b')!)).toBe(0); // 0 未満にはしない
    expect(down).toBe(bg2); // 寄せても見た目が変わらない＝同一参照（空の取り消しを積まない）
  });

  it('存在しない id は何も変えない', () => {
    const layers = [layer('a', 'text', 10)];
    expect(moveLayerZ(layers, 'nope', 'up')).toBe(layers); // 同一参照
  });
});
