import { describe, expect, it } from 'vitest';
import { layoutToSvg } from './sceneSvg';
import type { Fit } from '../domain/enums';
import type { SceneLayout } from './layout';

function imageLayout(fit: Fit = 'cover', assetId: string | null = 'asset_office_001'): SceneLayout {
  return {
    width: 1920,
    height: 1080,
    backgroundColor: '#ffffff',
    items: [
      { kind: 'image', id: 'slot', x: 80, y: 140, w: 1040, h: 800, zIndex: 10, assetId, fit, role: 'slot', label: 'メイン画像' },
    ],
  };
}

describe('layoutToSvg：画像スロット', () => {
  it('src未指定ならプレースホルダ枠（<image>は出さない）', () => {
    const svg = layoutToSvg(imageLayout());
    expect(svg).not.toContain('<image');
    expect(svg).toContain('<rect');
  });

  it('assetSrc が解決すると <image> を出す', () => {
    const svg = layoutToSvg(imageLayout(), {
      assetSrc: (id) => (id === 'asset_office_001' ? 'data:image/png;base64,AAAA' : undefined),
    });
    expect(svg).toContain('<image');
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
  });

  it('fit ごとに preserveAspectRatio が変わる', () => {
    const src = () => 'data:image/png;base64,AAAA';
    expect(layoutToSvg(imageLayout('cover'), { assetSrc: src })).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(layoutToSvg(imageLayout('contain'), { assetSrc: src })).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(layoutToSvg(imageLayout('stretch'), { assetSrc: src })).toContain('preserveAspectRatio="none"');
  });

  it('assetId=null（未設定）は src があっても（未設定）プレースホルダ', () => {
    const svg = layoutToSvg(imageLayout('cover', null), { assetSrc: () => 'data:image/png;base64,AAAA' });
    expect(svg).not.toContain('<image');
    expect(svg).toContain('（未設定）');
  });
});
