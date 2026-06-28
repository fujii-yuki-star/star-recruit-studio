import { describe, expect, it } from 'vitest';
import type { Layer } from './types';
import { addLayer, createLayerId, removeLayer, TEMPLATE_ADDABLE_LAYER_TYPES, updateLayer } from './layerOps';

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
