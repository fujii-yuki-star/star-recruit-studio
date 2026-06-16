import { describe, expect, it } from 'vitest';
import type { Asset, FreeElement } from './types';
import { validateFreeLayout } from './freeLayout';

const canvas = { width: 1920, height: 1080 };

const assets: Asset[] = [
  { assetId: 'asset_001', assetType: 'image', displayName: '写真A', filePath: 'a.png' },
  { assetId: 'asset_002', assetType: 'video', displayName: '動画B', filePath: 'b.mp4' },
];

const codes = (els: FreeElement[]): string[] =>
  validateFreeLayout(els, assets, canvas).map((w) => w.code);

describe('validateFreeLayout', () => {
  it('正常な要素（実在素材 slot / 文字あり text / 画面内）は警告なし', () => {
    const els: FreeElement[] = [
      { id: 'free_001', kind: 'slot', x: 100, y: 100, w: 800, h: 600, assetId: 'asset_001', fit: 'cover' },
      { id: 'free_002', kind: 'text', x: 1000, y: 100, w: 700, h: 200, text: '見出し' },
      { id: 'free_003', kind: 'shape', x: 0, y: 0, w: 1920, h: 1080, shapeType: 'rect', fillColor: '#000000' },
    ];
    expect(validateFreeLayout(els, assets, canvas)).toEqual([]);
  });

  it('空配列は警告なし', () => {
    expect(validateFreeLayout([], assets, canvas)).toEqual([]);
  });

  it('slot の assetId が存在しない素材を指す → ASSET_NOT_FOUND', () => {
    const els: FreeElement[] = [
      { id: 'free_001', kind: 'slot', x: 0, y: 0, w: 100, h: 100, assetId: 'asset_missing', fit: 'cover' },
    ];
    expect(codes(els)).toEqual(['ASSET_NOT_FOUND']);
  });

  it('slot の assetId が null（空スロット）は許容＝警告なし', () => {
    const els: FreeElement[] = [
      { id: 'free_001', kind: 'slot', x: 0, y: 0, w: 100, h: 100, assetId: null },
    ];
    expect(validateFreeLayout(els, assets, canvas)).toEqual([]);
  });

  it('text が空文字／空白のみ → FREE_TEXT_EMPTY（info）', () => {
    const empty: FreeElement[] = [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 100, text: '' }];
    const blank: FreeElement[] = [{ id: 'free_002', kind: 'text', x: 0, y: 0, w: 100, h: 100, text: '   ' }];
    const missing: FreeElement[] = [{ id: 'free_003', kind: 'text', x: 0, y: 0, w: 100, h: 100 }];
    for (const els of [empty, blank, missing]) {
      const ws = validateFreeLayout(els, assets, canvas);
      expect(ws.map((w) => w.code)).toEqual(['FREE_TEXT_EMPTY']);
      expect(ws[0].severity).toBe('info');
    }
  });

  it('w<=0 または h<=0 → FREE_ELEMENT_INVALID_SIZE のみ（サイズ不正時は画面外判定をスキップ＝二重警告にしない）', () => {
    // x=0,w=0 は x+w<=0 で画面外条件にも該当するが、サイズ不正を優先し OUT_OF_BOUNDS は出さない。
    const zeroW: FreeElement[] = [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 0, h: 100, shapeType: 'rect' }];
    const negH: FreeElement[] = [{ id: 'free_002', kind: 'shape', x: 0, y: 0, w: 100, h: -5, shapeType: 'rect' }];
    expect(codes(zeroW)).toEqual(['FREE_ELEMENT_INVALID_SIZE']);
    expect(codes(negH)).toEqual(['FREE_ELEMENT_INVALID_SIZE']);
  });

  it('canvas から完全に外れている → FREE_ELEMENT_OUT_OF_BOUNDS', () => {
    const right: FreeElement[] = [{ id: 'free_001', kind: 'shape', x: 1920, y: 0, w: 100, h: 100, shapeType: 'rect' }];
    const left: FreeElement[] = [{ id: 'free_002', kind: 'shape', x: -200, y: 0, w: 100, h: 100, shapeType: 'rect' }];
    const below: FreeElement[] = [{ id: 'free_003', kind: 'shape', x: 0, y: 1080, w: 100, h: 100, shapeType: 'rect' }];
    expect(codes(right)).toContain('FREE_ELEMENT_OUT_OF_BOUNDS');
    expect(codes(left)).toContain('FREE_ELEMENT_OUT_OF_BOUNDS');
    expect(codes(below)).toContain('FREE_ELEMENT_OUT_OF_BOUNDS');
  });

  it('一部だけはみ出している（画面と重なりがある）要素は許容＝OUT_OF_BOUNDS を出さない', () => {
    // x=1800 で幅 400（右に 280 はみ出す）が、左 120px は画面内 → 演出として許容。
    const els: FreeElement[] = [
      { id: 'free_001', kind: 'shape', x: 1800, y: -50, w: 400, h: 200, shapeType: 'rect' },
    ];
    expect(codes(els)).not.toContain('FREE_ELEMENT_OUT_OF_BOUNDS');
  });

  it('複数要素の警告を集約し、field に要素 id を含める', () => {
    const els: FreeElement[] = [
      { id: 'free_001', kind: 'slot', x: 0, y: 0, w: 100, h: 100, assetId: 'asset_missing', fit: 'cover' },
      { id: 'free_002', kind: 'text', x: 0, y: 0, w: 100, h: 100, text: '' },
    ];
    const ws = validateFreeLayout(els, assets, canvas);
    expect(ws).toHaveLength(2);
    expect(ws.find((w) => w.code === 'ASSET_NOT_FOUND')?.field).toBe('freeLayout.free_001');
    expect(ws.find((w) => w.code === 'FREE_TEXT_EMPTY')?.field).toBe('freeLayout.free_002');
  });
});
