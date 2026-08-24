import { describe, expect, it } from 'vitest';
import type { Layer } from './types';
import { addLayer, createLayerId, removeLayer, TEMPLATE_ADDABLE_LAYER_TYPES, updateLayer, usedTextKeys, textKeyOfLayer } from './layerOps';

const canvas = { width: 1920, height: 1080 };

describe('TEMPLATE_ADDABLE_LAYER_TYPES', () => {
  it('decor は開放しない（7種・ADR-0017）', () => {
    expect(TEMPLATE_ADDABLE_LAYER_TYPES).not.toContain('decor');
    expect(TEMPLATE_ADDABLE_LAYER_TYPES).toEqual(['background', 'slot', 'text', 'subtitle', 'character', 'shape', 'logo']);
  });
});

describe('createLayerId', () => {
  it('layer_NNN を採番し、空き番号を埋める', () => {
    expect(createLayerId([])).toBe('layer_001');
    const layers: Layer[] = [{ id: 'layer_001', type: 'text', x: 0, y: 0, w: 10, h: 10 }];
    expect(createLayerId(layers)).toBe('layer_002');
    // 記述的 id（bg 等）は無視して layer_NNN だけ見る。
    expect(createLayerId([{ id: 'bg', type: 'background', x: 0, y: 0, w: 10, h: 10 }])).toBe('layer_001');
  });

  it('空き番号を埋める（layer_001 と layer_003 があれば layer_002）', () => {
    const layers: Layer[] = [
      { id: 'layer_001', type: 'text', x: 0, y: 0, w: 10, h: 10 },
      { id: 'layer_003', type: 'shape', x: 0, y: 0, w: 10, h: 10 },
    ];
    expect(createLayerId(layers)).toBe('layer_002');
  });
});

describe('addLayer', () => {
  it('background は全面・最前面（zIndex 最大+1）', () => {
    const layers: Layer[] = [{ id: 'a', type: 'text', x: 0, y: 0, w: 10, h: 10, zIndex: 3 }];
    const next = addLayer(layers, 'background', canvas);
    const added = next[next.length - 1];
    expect(added).toMatchObject({ type: 'background', x: 0, y: 0, w: 1920, h: 1080, zIndex: 4 });
  });

  it('background 以外はキャンバス中央あたりに既定サイズで置く', () => {
    const next = addLayer([], 'text', canvas);
    const added = next[0];
    expect(added.type).toBe('text');
    expect(added.w).toBe(480);
    expect(added.h).toBe(240);
    expect(added.x).toBe(Math.round(1920 / 2 - 480 / 2)); // 720
    expect(added.zIndex).toBe(1);
  });

  it('text/subtitle は textKey 既定（見出し/字幕）を持って追加される（描画で空にならない・他型は未設定）', () => {
    expect(addLayer([], 'text', canvas)[0].textKey).toBe('title');
    expect(addLayer([], 'subtitle', canvas)[0].textKey).toBe('subtitle');
    expect(addLayer([], 'shape', canvas)[0].textKey).toBeUndefined();
  });
});

describe('removeLayer / updateLayer', () => {
  const layers: Layer[] = [
    { id: 'a', type: 'text', x: 0, y: 0, w: 10, h: 10 },
    { id: 'b', type: 'shape', x: 0, y: 0, w: 10, h: 10 },
  ];

  it('removeLayer：指定 id を取り除く', () => {
    expect(removeLayer(layers, 'a').map((l) => l.id)).toEqual(['b']);
  });

  it('updateLayer：指定 id の x/y/w/h 等を部分更新（id/type は不変）', () => {
    const next = updateLayer(layers, 'a', { x: 100, y: 200, w: 300 });
    expect(next.find((l) => l.id === 'a')).toMatchObject({ id: 'a', type: 'text', x: 100, y: 200, w: 300, h: 10 });
    expect(next.find((l) => l.id === 'b')).toBe(layers[1]); // 対象外は同一参照
  });
});

describe('usedTextKeys', () => {
  const g = (over: Partial<Layer>): Layer => ({ id: 'x', type: 'text', x: 0, y: 0, w: 10, h: 10, ...over });

  it('text 層は textKey 指定のものだけ・正規順（TEXT_KEYS 順）で返す', () => {
    const layers: Layer[] = [
      g({ id: '1', type: 'text', textKey: 'caption' }),
      g({ id: '2', type: 'text', textKey: 'title' }),
      g({ id: '3', type: 'text' }), // textKey 無し＝束縛しないので含めない
      g({ id: '4', type: 'shape' }), // 非テキスト層は無関係
    ];
    expect(usedTextKeys(layers)).toEqual(['title', 'caption']);
  });

  it('subtitle 層は textKey 未指定なら subtitle として数える（layoutScene の既定束縛に一致）', () => {
    expect(usedTextKeys([g({ id: '1', type: 'subtitle' })])).toEqual(['subtitle']);
    // subtitle 層に別 textKey を持たせればそちら。重複は1つに集約。
    expect(usedTextKeys([g({ id: '1', type: 'subtitle', textKey: 'main' }), g({ id: '2', type: 'text', textKey: 'main' })])).toEqual(['main']);
  });

  it('テキスト層が無ければ空', () => {
    expect(usedTextKeys([g({ id: '1', type: 'slot' }), g({ id: '2', type: 'background' })])).toEqual([]);
  });
});

// 文字の層の textKey は**解き方を1か所から**（#818 レビュー 🟡）＝呼び出し側で既定を書き直すと、
// 欄はあるのに「無い」と判断される（ドリルインが字幕の層で空振りしていた）。
describe('textKeyOfLayer（その層が使う textKey）', () => {
  const layer = (over: Record<string, unknown>): Layer =>
    ({ id: 'l1', x: 0, y: 0, w: 10, h: 10, ...over }) as Layer;

  it('文字の層は持っている textKey', () => {
    expect(textKeyOfLayer(layer({ type: 'text', textKey: 'title' }))).toBe('title');
  });

  it('字幕の層は**未指定なら subtitle**（描画の既定と同じ）', () => {
    expect(textKeyOfLayer(layer({ type: 'subtitle' }))).toBe('subtitle');
    expect(textKeyOfLayer(layer({ type: 'subtitle', textKey: 'body' }))).toBe('body');
  });

  it('文字を持たない層は null', () => {
    expect(textKeyOfLayer(layer({ type: 'slot' }))).toBeNull();
    expect(textKeyOfLayer(layer({ type: 'text' }))).toBeNull(); // 文字の層でも textKey が無ければ欄は無い
  });

  it('欄の一覧（usedTextKeys）と同じ解き方（既定が食い違わない）', () => {
    const layers = [layer({ id: 'l1', type: 'subtitle' })];
    expect(usedTextKeys(layers)).toEqual([textKeyOfLayer(layers[0])]);
  });
});
