// 文字の幅を同梱の字体の実測表から引く（ADR-0063）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUNDLED_FONT_FILES, DEFAULT_FONT_ID, FONT_CATALOG } from '../font/fontCatalog';
import { readFontAdvances } from '../font/fontAdvance';
import { buildFontMetrics } from './fontMetricsBuild';
import { BUNDLED_FONT_METRICS } from './generated/bundledFontMetrics';
import { charWidthEmIn, estimatedCharWidthEm, textFontFor, type TextFont } from './fontMetrics';
import { wrapText } from './textWrap';

const readerOf = (file: string) => {
  const r = readFontAdvances(new Uint8Array(readFileSync(`public/fonts/${file}`)));
  if (!r) throw new Error(file);
  return r;
};
const allFiles = [...new Set(Object.values(BUNDLED_FONT_FILES).flatMap((f) => [f.regular, f.bold]))].sort();
const GEN: TextFont = { fontId: 'gen-interface-jp', bold: false };
const GEN_BOLD: TextFont = { fontId: 'gen-interface-jp', bold: true };
const KAITOU: TextFont = { fontId: 'kaitou-yokoku-gothic', bold: false };

describe('字幅表（作られたファイル）', () => {
  it('同梱の字体ファイルすべてぶんの表がある（足りない・余計がない）', () => {
    expect(Object.keys(BUNDLED_FONT_METRICS).sort()).toEqual(allFiles);
  });

  // ⚠️ **字体を差し替えて作り直し忘れたら赤くなる**（`npm run gen:font-metrics`）。
  it.each(allFiles)('%s：字体ファイルから作り直したものと同じ（作り直し忘れがない）', (file) => {
    expect(BUNDLED_FONT_METRICS[file]).toEqual(buildFontMetrics(readerOf(file)));
  });
});

describe('charWidthEmIn：字体の実測を引く', () => {
  // 字体ファイルから直接読んだ値と比べる（表の作り方・引き方のどちらが壊れても赤くなる）。
  // 英数字・かな・約物・全角（字ごとの区間）／CJK の既定の幅／CJK の違う幅（怪盗予告ゴシックの「社」「採」）。
  const samples = ['A', 'W', 'a', 'i', '0', ' ', '。', 'あ', 'ア', 'Ａ', '社', '採', '一', '鬱'];
  for (const f of FONT_CATALOG) {
    for (const bold of [false, true]) {
      const file = bold ? BUNDLED_FONT_FILES[f.cssFamily]!.bold : BUNDLED_FONT_FILES[f.cssFamily]!.regular;
      it(`${f.label}（${bold ? '太字' : '標準'}）：字体ファイルの送り幅と同じ`, () => {
        const r = readerOf(file);
        for (const ch of samples) {
          const adv = r.advanceOf(ch.codePointAt(0)!);
          const expected = adv == null ? estimatedCharWidthEm(ch.codePointAt(0)!) : adv / r.unitsPerEm;
          expect(charWidthEmIn(ch, { fontId: f.id, bold }), `${ch}`).toBeCloseTo(expected, 10);
        }
      });
    }
  }

  it('実際の字幅は見積もりと違う（＝この ADR が直したもの）', () => {
    expect(charWidthEmIn('A', GEN_BOLD)).toBeGreaterThan(0.7); // 見積もりは 0.55
    expect(charWidthEmIn('社', KAITOU)).toBeCloseTo(1.305, 3); // 見積もりは 1.0
    expect(charWidthEmIn('あ', GEN)).toBeLessThan(0.95); // 見積もりは 1.0
  });

  it('太字と標準は別の表を引く', () => {
    expect(charWidthEmIn('A', GEN_BOLD)).not.toBe(charWidthEmIn('A', GEN));
  });

  it('字体に無い字は今までの見積もり（代わりの字体で描かれる＝字体からは幅が分からない）', () => {
    // U+2007（数字幅の空白）は Gen Interface にあり、怪盗予告ゴシックに無い。
    const figureSpace = String.fromCodePoint(0x2007);
    expect(readerOf('KaitouYokokuGothic.ttf').advanceOf(0x2007)).toBeNull();
    expect(readerOf('GenInterfaceJP-Regular.ttf').advanceOf(0x2007)).not.toBeNull();
    expect(charWidthEmIn(figureSpace, KAITOU)).toBe(1);
    expect(charWidthEmIn(figureSpace, GEN)).not.toBe(1);
  });

  it('表の外の字（絵文字など）は今までの見積もり', () => {
    expect(charWidthEmIn('😀', GEN)).toBe(1);
  });

  it('字体を渡さないときは今までの見積もり', () => {
    expect(charWidthEmIn('A', undefined)).toBe(0.55);
    expect(charWidthEmIn('あ', undefined)).toBe(1);
  });

  it('持ち込み・拡張パックの字体は汎用の表＝見積もりと Gen Interface JP 太字の大きい方（今より狭く見ない）', () => {
    for (const fontId of ['user_font_001', 'pack_office__mincho']) {
      const font = { fontId, bold: false };
      expect(charWidthEmIn('A', font)).toBe(charWidthEmIn('A', GEN_BOLD)); // 実測の方が広い
      expect(charWidthEmIn('あ', font)).toBe(1); // 見積もりの方が広い
      expect(charWidthEmIn('😀', font)).toBe(1); // 表の外＝見積もり
    }
  });
});

describe('textFontFor：描画と同じ解き方（要素 → 場面 → 動画全体 → 既定・#178）', () => {
  it('要素の指定が最優先', () => {
    expect(textFontFor('kaitou-yokoku-gothic', 'gen-interface-jp-display', 'gen-interface-jp', 'normal').fontId).toBe('kaitou-yokoku-gothic');
  });
  it('要素に無ければ場面、場面に無ければ動画全体、どれも無ければ既定', () => {
    expect(textFontFor(undefined, 'gen-interface-jp-display', 'kaitou-yokoku-gothic', 'normal').fontId).toBe('gen-interface-jp-display');
    expect(textFontFor(null, null, 'kaitou-yokoku-gothic', 'normal').fontId).toBe('kaitou-yokoku-gothic');
    expect(textFontFor(undefined, undefined, undefined, 'normal').fontId).toBe(DEFAULT_FONT_ID);
  });
  it('知らない id は次へ落ちる（描画と同じ）', () => {
    expect(textFontFor('nope', 'nope', 'kaitou-yokoku-gothic', 'normal').fontId).toBe('kaitou-yokoku-gothic');
  });
  it('太さは文字の太さから', () => {
    expect(textFontFor(undefined, undefined, undefined, 'bold').bold).toBe(true);
    expect(textFontFor(undefined, undefined, undefined, 'normal').bold).toBe(false);
  });
});

describe('wrapText：字体の字幅で折り返す', () => {
  it('同じ文でも字体で行数が変わる（英字の多い文は見積もりより早く折り返す）', () => {
    const text = 'STARIO SYSTEM'; // 13字
    // 見積もり：0.55×13×100 = 715 → 800px に1行で入る。実測（太字）は 800px を超える。
    expect(wrapText(text, 800, 100, 3, 0, undefined)).toHaveLength(1);
    expect(wrapText(text, 800, 100, 3, 0, GEN_BOLD).length).toBeGreaterThan(1);
  });
  it('怪盗予告ゴシックの漢字は 1em より広い＝見積もりより早く折り返す', () => {
    const text = '採用社員'; // 見積もり 4em
    expect(wrapText(text, 420, 100, 3, 0, undefined)).toHaveLength(1);
    expect(wrapText(text, 420, 100, 3, 0, KAITOU).length).toBeGreaterThan(1);
  });
});
