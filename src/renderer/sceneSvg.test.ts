import { describe, expect, it } from 'vitest';
import { charWidthEm, layoutToSvg, wrapText } from './sceneSvg';
import { fontFamilyForId } from '../domain/font/fontCatalog';
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

describe('charWidthEm（文字幅の概算・§7）', () => {
  it('半角(ASCII/Latin-1)は約0.55em', () => {
    expect(charWidthEm('A')).toBe(0.55);
    expect(charWidthEm('1')).toBe(0.55);
    expect(charWidthEm(' ')).toBe(0.55);
  });
  it('全角（日本語など）は約1em', () => {
    expect(charWidthEm('あ')).toBe(1.0);
    expect(charWidthEm('新')).toBe(1.0);
  });
});

describe('wrapText（折返し・あふれ判定・§7）', () => {
  it('幅に収まる全角は折り返さない', () => {
    // fontSize40・maxWidth1000 → 全角25まで。20文字は1行。
    expect(wrapText('あ'.repeat(20), 1000, 40, 3)).toEqual(['あ'.repeat(20)]);
  });
  it('全角は幅を超えると折り返す（10文字/行 @ 400px・fs40）', () => {
    const lines = wrapText('あ'.repeat(25), 400, 40, 5);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('あ'.repeat(10));
    expect(lines[2]).toBe('あ'.repeat(5));
  });
  it('半角は全角より多く詰まる（18文字/行 @ 400px・fs40）', () => {
    const lines = wrapText('A'.repeat(40), 400, 40, 5);
    expect(lines[0]).toHaveLength(18);
  });
  it('全角＋半角の混在を幅で折り返す', () => {
    const lines = wrapText('あA'.repeat(20), 400, 40, 5);
    expect(lines.length).toBeGreaterThan(1);
  });
  it('maxLines を超える分は末尾を … で切る', () => {
    const lines = wrapText('あ'.repeat(30), 400, 40, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
  });
  it('maxWidth < fontSize はガードしてそのまま返す', () => {
    expect(wrapText('あいうえお', 10, 40, 3)).toEqual(['あいうえお']);
  });
});

describe('layoutToSvg：responsive オプション（A3-2・向きプレビュー）', () => {
  const ns = 'http://www.w3.org/2000/svg';
  it('既定は SVG ルートに layout 実寸を出す（書き出しのラスタライズ用）', () => {
    const svg = layoutToSvg(imageLayout());
    expect(svg).toContain(`<svg xmlns="${ns}" width="1920" height="1080" viewBox="0 0 1920 1080">`);
  });
  it('responsive:true は SVG ルートを 100% にし viewBox で座標系を保持（コンテナにフィット）', () => {
    const svg = layoutToSvg(imageLayout(), { responsive: true });
    expect(svg).toContain(`<svg xmlns="${ns}" width="100%" height="100%" viewBox="0 0 1920 1080">`);
  });
});

describe('layoutToSvg：常時クレジット（credit・ADR-0003）', () => {
  it('credit 指定でクレジット文字を焼き込む', () => {
    expect(layoutToSvg(imageLayout(), { credit: 'VOICEVOX:ずんだもん' })).toContain('VOICEVOX:ずんだもん');
  });
  it('credit 未指定なら焼き込まない', () => {
    expect(layoutToSvg(imageLayout())).not.toContain('VOICEVOX：ずんだもん');
  });
  it('クレジットは body より後＝最前面に置く', () => {
    // 画像スロットのプレースホルダ枠（メイン画像）より後にクレジットが来る。
    const svg = layoutToSvg(imageLayout(), { credit: 'CREDIT_X' });
    expect(svg.indexOf('CREDIT_X')).toBeGreaterThan(svg.indexOf('メイン画像'));
  });
});

describe('layoutToSvg：フォント（fontFamily・同梱フォント選択）', () => {
  it('fontFamily 指定がテキストの font-family 属性に反映される', () => {
    const svg = layoutToSvg(imageLayout(), { fontFamily: "'TestFont X', sans-serif" });
    expect(svg).toContain(`font-family="'TestFont X', sans-serif"`);
  });
  it('fontFamily 未指定は既定フォント（fontCatalog 既定）になる', () => {
    expect(layoutToSvg(imageLayout())).toContain(`font-family="${fontFamilyForId(undefined)}"`);
  });

  it('TextItem 自身の fontId が場面既定(opts.fontFamily)より優先（要素ごとフォント・#178）', () => {
    const layout: SceneLayout = {
      width: 1920, height: 1080, backgroundColor: '#ffffff',
      items: [
        { kind: 'text', id: 't1', x: 0, y: 0, w: 800, h: 100, zIndex: 30, text: '見出し', fontSize: 40, fontWeight: 'normal', color: '#000000', maxLines: 1, isSubtitle: false, fontId: 'kaitou-yokoku-gothic' },
        { kind: 'text', id: 't2', x: 0, y: 200, w: 800, h: 100, zIndex: 31, text: '本文', fontSize: 40, fontWeight: 'normal', color: '#000000', maxLines: 1, isSubtitle: false },
      ],
    };
    const svg = layoutToSvg(layout, { fontFamily: "'Scene Default', sans-serif" });
    expect(svg).toContain(`font-family="${fontFamilyForId('kaitou-yokoku-gothic')}"`); // t1 は自身の fontId
    expect(svg).toContain(`font-family="'Scene Default', sans-serif"`); // t2 は場面既定にフォールバック
  });
});

describe('layoutToSvg：テキストの XSS エスケープ（dangerouslySetInnerHTML 経路・#144）', () => {
  it('特殊文字（& < > " \')を実体参照化し、生のタグ/クォートを残さない', () => {
    const layout: SceneLayout = {
      width: 1920,
      height: 1080,
      backgroundColor: '#ffffff',
      items: [
        {
          kind: 'text',
          id: 't',
          x: 100,
          y: 100,
          w: 1600,
          h: 200,
          zIndex: 10,
          text: `O'Brien <script> & "x"`,
          fontSize: 40,
          fontWeight: 'normal',
          color: '#000000',
          maxLines: 3,
          isSubtitle: false,
        },
      ],
    };
    const svg = layoutToSvg(layout);
    expect(svg).toContain('&#39;'); // '
    expect(svg).toContain('&lt;'); // <
    expect(svg).toContain('&gt;'); // >
    expect(svg).toContain('&amp;'); // &
    expect(svg).toContain('&quot;'); // "
    expect(svg).not.toContain('<script>'); // 生タグが注入されない
    expect(svg).not.toContain("O'Brien"); // 生の ' を残さない
  });
});
