import { describe, expect, it } from 'vitest';
import { FREE_SHAPE_TYPE } from '../domain/enums';
import type { FillItem } from './layout';
import {
  arrowPoints, freeShapeSvg, roundedRectRadius, speechBubblePath, starPoints, trianglePoints,
} from './freeShapes';

function fill(overrides: Partial<FillItem> = {}): FillItem {
  return {
    id: 'free_001', x: 0, y: 0, w: 100, h: 100, zIndex: 1,
    kind: 'fill', color: '#ff0000', opacity: 1, radius: 0, ...overrides,
  };
}

describe('freeShapes 頂点/パス（純粋関数）', () => {
  it('trianglePoints：上頂点＋左下＋右下（bbox 充填・整数）', () => {
    expect(trianglePoints(0, 0, 100, 80)).toBe('50,0 0,80 100,80');
  });

  it('starPoints：spikes×2 点・上頂点(50,0)始まり・全て整数ペア', () => {
    const pts = starPoints(0, 0, 100, 100).split(' ');
    expect(pts).toHaveLength(10); // 5 spikes × 2（外/内）
    expect(pts[0]).toBe('50,0');
    expect(pts.every((p) => /^-?\d+,-?\d+$/.test(p))).toBe(true);
  });

  it('arrowPoints：7 点・右端中央に矢じり先端', () => {
    const pts = arrowPoints(0, 0, 100, 100).split(' ');
    expect(pts).toHaveLength(7);
    expect(pts).toContain('100,50');
  });

  it('speechBubblePath：M で始まり Z で閉じ、しっぽ先端(L 24 100)を含む', () => {
    const d = speechBubblePath(0, 0, 200, 100);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toContain('L 24 100'); // しっぽ先端 x=w*0.12=24・y=h=100（座標ロジックの回帰検知）
  });

  it('roundedRectRadius：短辺の 15%（整数）', () => {
    expect(roundedRectRadius(200, 100)).toBe(15);
  });
});

describe('freeShapeSvg（FillItem → SVG・枠線付与）', () => {
  it('rect は従来出力と一致（rx=radius・枠線なし＝後方互換）', () => {
    expect(freeShapeSvg(fill({ shapeType: FREE_SHAPE_TYPE.rect, radius: 8 }))).toBe(
      '<rect x="0" y="0" width="100" height="100" rx="8" fill="#ff0000" fill-opacity="1"/>',
    );
  });

  it('ellipse は <ellipse>', () => {
    expect(freeShapeSvg(fill({ shapeType: FREE_SHAPE_TYPE.ellipse }))).toContain('<ellipse');
  });

  it('ellipse も枠線を付与できる（strokeWidth>0）', () => {
    const svg = freeShapeSvg(fill({ shapeType: FREE_SHAPE_TYPE.ellipse, strokeWidth: 3, strokeColor: '#0000ff' }));
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('stroke="#0000ff"');
    expect(svg).toContain('stroke-width="3"');
  });

  it('rounded_rect は rx に角丸半径（旧 radius フィールド非依存）', () => {
    const svg = freeShapeSvg(fill({ shapeType: FREE_SHAPE_TYPE.rounded_rect, radius: 0 }));
    expect(svg).toContain('<rect');
    expect(svg).toContain('rx="15"');
  });

  it('triangle/star/arrow は <polygon>', () => {
    for (const t of [FREE_SHAPE_TYPE.triangle, FREE_SHAPE_TYPE.star, FREE_SHAPE_TYPE.arrow]) {
      expect(freeShapeSvg(fill({ shapeType: t }))).toContain('<polygon points="');
    }
  });

  it('speech_bubble は <path>', () => {
    expect(freeShapeSvg(fill({ shapeType: FREE_SHAPE_TYPE.speech_bubble }))).toContain('<path d="');
  });

  it('strokeWidth>0 で枠線属性を付与（色は既定 #000000）', () => {
    const svg = freeShapeSvg(fill({ shapeType: FREE_SHAPE_TYPE.star, strokeWidth: 4 }));
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('stroke-width="4"');
  });

  it('strokeColor は反映、strokeWidth 0/未指定では枠線属性なし', () => {
    expect(freeShapeSvg(fill({ shapeType: FREE_SHAPE_TYPE.rect, strokeWidth: 2, strokeColor: '#00ff00' })))
      .toContain('stroke="#00ff00"');
    expect(freeShapeSvg(fill({ shapeType: FREE_SHAPE_TYPE.rect, strokeWidth: 0 }))).not.toContain('stroke=');
    expect(freeShapeSvg(fill({ shapeType: FREE_SHAPE_TYPE.rect }))).not.toContain('stroke=');
  });
});
