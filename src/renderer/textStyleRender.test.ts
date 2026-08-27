// 文字の体裁（影・字間・背景帯）の描画（#264）。
//
// ⚠️ **プレビューと書き出しは同じ Blink で描く**（`rasterize.ts`）ので、`feDropShadow` も
// `letter-spacing` もどちらでも同じ絵になる＝**パリティは構造で保たれる**（別々に検査しない）。
import { describe, expect, it } from 'vitest';
import { layoutToSvg } from './sceneSvg';
import type { SceneLayout } from './layout';

const layout = (over: Record<string, unknown> = {}): SceneLayout => ({
  width: 1920, height: 1080, backgroundColor: '#ffffff',
  items: [{
    id: 'free_001', kind: 'text', x: 100, y: 100, w: 800, h: 200,
    text: 'あいう', fontSize: 40, fontWeight: 'normal', color: '#ffffff',
    maxLines: 2, isSubtitle: false, ...over,
  }],
} as unknown as SceneLayout);

describe('字間（#264）', () => {
  /**
   * ⚠️ **未指定・0 のときは属性を出さない**＝**従来の出力は1バイトも変わらない**
   *（既に作った動画を開き直したときに絵が動かない）。
   */
  it('未指定・0 なら属性を出さない', () => {
    expect(layoutToSvg(layout())).not.toContain('letter-spacing');
    expect(layoutToSvg(layout({ letterSpacing: 0 }))).not.toContain('letter-spacing');
  });

  // ⚠️ **em で持つ**＝文字サイズを変えても詰め具合が変わらない。描くときに px へ直す。
  it('em を文字サイズに掛けて px にする', () => {
    expect(layoutToSvg(layout({ letterSpacing: 0.1 }))).toContain('letter-spacing="4"'); // 40px × 0.1
    expect(layoutToSvg(layout({ letterSpacing: 0.1, fontSize: 80 }))).toContain('letter-spacing="8"');
  });

  it('負の値で詰められる', () => {
    expect(layoutToSvg(layout({ letterSpacing: -0.05 }))).toContain('letter-spacing="-2"');
  });
});

describe('影（#264）', () => {
  it('未指定なら影を出さない（従来の出力は不変）', () => {
    const svg = layoutToSvg(layout());
    expect(svg).not.toContain('feDropShadow');
    expect(svg).not.toContain('filter=');
  });

  it('影があれば feDropShadow を敷く', () => {
    const svg = layoutToSvg(layout({ shadow: { enabled: true, color: '#112233', opacity: 0.4, blur: 8, dx: 3, dy: 4 } }));
    expect(svg).toContain('<feDropShadow dx="3" dy="4" stdDeviation="4"'); // ぼかしは半分（標準偏差）
    expect(svg).toContain('flood-color="#112233"');
    expect(svg).toContain('flood-opacity="0.4"');
    expect(svg).toContain('filter="url(#shadow-free_001)"');
  });

  /**
   * ⚠️ **id は要素ごとに一意**＝同じ場面に複数の影があると、同じ id の filter が混ざって
   * **後の定義が前を上書き**する（全部が最後の影になる）。
   */
  it('影が複数あっても混ざらない（id が別）', () => {
    const two = {
      width: 1920, height: 1080, backgroundColor: '#fff',
      items: [
        { id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'あ', fontSize: 40, fontWeight: 'normal', color: '#fff', maxLines: 1, isSubtitle: false, shadow: { enabled: true, dx: 1 } },
        { id: 'free_002', kind: 'text', x: 0, y: 60, w: 100, h: 50, text: 'い', fontSize: 40, fontWeight: 'normal', color: '#fff', maxLines: 1, isSubtitle: false, shadow: { enabled: true, dx: 9 } },
      ],
    } as unknown as SceneLayout;
    const svg = layoutToSvg(two);
    expect(svg).toContain('id="shadow-free_001"');
    expect(svg).toContain('id="shadow-free_002"');
    expect(svg).toContain('filter="url(#shadow-free_001)"');
    expect(svg).toContain('filter="url(#shadow-free_002)"');
  });

  // ⚠️ **id に使えない文字は落とす**（同時字幕の `__sub1` など）＝壊れた SVG を作らない。
  it('id に使えない文字が入っていても壊れない', () => {
    const svg = layoutToSvg(layout({ id: 'sub__sub1', shadow: { enabled: true } }));
    expect(svg).toContain('id="shadow-sub__sub1"');
    expect(svg).not.toMatch(/id="shadow-[^"]*[^A-Za-z0-9_"-]/);
  });
});
