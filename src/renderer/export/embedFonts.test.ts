// 書き出しで焼く SVG に字体を埋め込む（ADR-0062）。
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { BUNDLED_FONT_FILES, FONT_CATALOG } from '../../domain/font/fontCatalog';
import * as subsetModule from '../../domain/font/fontSubset';
import { collectFontUses, FontEmbedder, fontSourceFor, type FontSource } from './embedFonts';

// 字体を作った回数を数える（毎コマ作り直していないかを見る）。
vi.mock('../../domain/font/fontSubset', async (orig) => {
  const actual = await orig<typeof import('../../domain/font/fontSubset')>();
  return { ...actual, subsetFontKeepingTables: vi.fn(actual.subsetFontKeepingTables) };
});

const realBytes = async (s: FontSource): Promise<Uint8Array> =>
  new Uint8Array(readFileSync(`public/fonts/${s.kind === 'bundled' ? s.file : 'KaitouYokokuGothic.ttf'}`));

const svgOf = (...texts: string[]): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/>${texts.join('')}</svg>`;
const text = (family: string, body: string, weight = 'normal'): string =>
  `<text x="0" y="0" font-family="${family}" font-size="20" font-weight="${weight}">${body}</text>`;

describe('collectFontUses', () => {
  it('字体と太さごとに、使う字を集める（文字の参照を戻す）', () => {
    const uses = collectFontUses(svgOf(
      text("'Gen Interface JP', sans-serif", 'あい&amp;&lt;'),
      text("'Gen Interface JP', sans-serif", 'う', 'bold'),
      text('&apos;pack_office__mincho&apos;, sans-serif', 'えお'),
    ));
    const pick = (f: string, b: boolean) => uses.find((u) => u.family === f && u.bold === b);
    expect([...pick('Gen Interface JP', false)!.codepoints].map((c) => String.fromCodePoint(c)).sort()).toEqual(['&', '<', 'あ', 'い']);
    expect([...pick('Gen Interface JP', true)!.codepoints].map((c) => String.fromCodePoint(c))).toEqual(['う']);
    expect(pick('pack_office__mincho', false)).toBeTruthy();
  });

  it('700 以上は太字・字体の無い text は数えない', () => {
    const uses = collectFontUses(svgOf(text("'Kaitou Yokoku Gothic'", 'か', '700'), '<text x="0">字体なし</text>'));
    expect(uses).toHaveLength(1);
    expect(uses[0]!.bold).toBe(true);
  });
});

describe('fontSourceFor', () => {
  it('同梱は太さごとのファイル・持ち込みとパックは id・知らない字体は埋め込まない', () => {
    expect(fontSourceFor('Gen Interface JP', false)).toEqual({ kind: 'bundled', file: 'GenInterfaceJP-Regular.ttf' });
    expect(fontSourceFor('Gen Interface JP', true)).toEqual({ kind: 'bundled', file: 'GenInterfaceJP-Bold.ttf' });
    expect(fontSourceFor('user_font_003', true)).toEqual({ kind: 'external', fontId: 'user_font_003' });
    expect(fontSourceFor('pack_office__mincho', false)).toEqual({ kind: 'external', fontId: 'pack_office__mincho' });
    expect(fontSourceFor('Yu Gothic', false)).toBeNull();
  });

  // ⚠️ 仕上がり確認が使う実体（fonts.css の @font-face）と同じファイルを埋め込む。
  it('同梱の字体の一覧と実体は、fonts.css の @font-face と同じ', () => {
    const css = readFileSync('src/styles/fonts.css', 'utf8');
    const faces = [...css.matchAll(/font-family:\s*'([^']+)';\s*src:\s*url\('\/fonts\/([^']+)'\)[^}]*font-weight:\s*([0-9 ]+);/g)]
      .map((m) => ({ family: m[1]!, file: m[2]!, weight: m[3]!.trim() }));
    expect(faces.length).toBeGreaterThanOrEqual(5);
    for (const f of faces) {
      const files = BUNDLED_FONT_FILES[f.family];
      expect(files, f.family).toBeTruthy();
      if (f.weight === '700') expect(files!.bold).toBe(f.file);
      else if (f.weight === '400') expect(files!.regular).toBe(f.file);
      else expect([files!.regular, files!.bold]).toEqual([f.file, f.file]);
    }
    for (const c of FONT_CATALOG) expect(BUNDLED_FONT_FILES[c.cssFamily], c.cssFamily).toBeTruthy();
  });
});

describe('FontEmbedder', () => {
  it('<svg> の直後に @font-face を書き込む（使う字だけの小さな字体）', async () => {
    const e = new FontEmbedder(realBytes);
    const out = await e.embed(svgOf(text("'Gen Interface JP', sans-serif", 'テキスト')));
    const m = /^<svg[^>]*><defs><style>@font-face\{font-family:"Gen Interface JP";src:url\(data:font\/ttf;base64,([A-Za-z0-9+/=]+)\);font-weight:400\}<\/style><\/defs><rect/.exec(out);
    expect(m != null).toBe(true);
    expect(m![1]!.length).toBeLessThan(1_500_000); // 6MB の字体を丸ごと入れていない
  });

  it('知らない字体だけなら何も足さない', async () => {
    const svg = svgOf(text("'Yu Gothic'", 'あ'));
    expect((await new FontEmbedder(realBytes).embed(svg)) === svg).toBe(true);
  });

  it('1ファイルの字体を普通と太字で使っても、規則は1つ（全部の太さ）', async () => {
    const out = await new FontEmbedder(realBytes).embed(svgOf(
      text("'Kaitou Yokoku Gothic'", 'あ'),
      text("'Kaitou Yokoku Gothic'", 'い', 'bold'),
    ));
    expect((out.match(/@font-face/g) ?? []).length).toBe(1);
    expect(out.includes('font-weight:100 900'), 'font-weight:100 900').toBe(true);
  });

  it('同梱の Gen Interface の太字は別の実体（太さ 700）', async () => {
    const out = await new FontEmbedder(realBytes).embed(svgOf(
      text("'Gen Interface JP'", 'あ'),
      text("'Gen Interface JP'", 'い', 'bold'),
    ));
    expect((out.match(/@font-face/g) ?? []).length).toBe(2);
    expect(out.includes('font-weight:400'), 'font-weight:400').toBe(true);
    expect(out.includes('font-weight:700'), 'font-weight:700').toBe(true);
  });

  it('実体は字体ごとに1回だけ読み、覚えた字で足りれば作り直さない・新しい字が出たら作り直す', async () => {
    const load = vi.fn(realBytes);
    const e = new FontEmbedder(load);
    const a = await e.embed(svgOf(text("'Gen Interface JP'", 'あいう')));
    const b = await e.embed(svgOf(text("'Gen Interface JP'", 'いう')));
    expect(load).toHaveBeenCalledTimes(1);
    const url = (s: string) => /src:url\(([^)]+)\)/.exec(s)![1];
    expect(url(b) === url(a)).toBe(true); // 足りる＝同じ字体
    const c = await e.embed(svgOf(text("'Gen Interface JP'", 'え')));
    expect(load).toHaveBeenCalledTimes(1);
    expect(url(c) !== url(a)).toBe(true); // 新しい字＝それまでの字と合わせて作り直す
  });

  it('作った字体を使い回す＝足りる字なら作り直さない・新しい字はそれまでの字と合わせて1回だけ作る', async () => {
    const subset = vi.mocked(subsetModule.subsetFontKeepingTables);
    subset.mockClear();
    const e = new FontEmbedder(realBytes);
    await e.embed(svgOf(text("'Gen Interface JP'", 'あいう')));
    await e.embed(svgOf(text("'Gen Interface JP'", 'いう')));
    expect(subset).toHaveBeenCalledTimes(1);
    await e.embed(svgOf(text("'Gen Interface JP'", 'え')));
    expect(subset).toHaveBeenCalledTimes(2);
    // 「え」で作り直したとき「あいう」も入れてある＝「あ」に戻っても作り直さない
    await e.embed(svgOf(text("'Gen Interface JP'", 'あえ')));
    expect(subset).toHaveBeenCalledTimes(2);
  });

  it('実体を読めなければ投げる（黙って既定の字体で焼かない）', async () => {
    const e = new FontEmbedder(() => Promise.reject(new Error('x')));
    await expect(e.embed(svgOf(text("'Gen Interface JP'", 'あ')))).rejects.toThrow();
  });
});

describe('FontEmbedder（字体として受け付けられるか・PR レビュー 🟡）', () => {
  it('作った字体が受け付けられなければ丸ごと埋め込む', async () => {
    let calls = 0;
    const e = new FontEmbedder(realBytes, async (b) => {
      calls += 1;
      return b.length > 5_000_000; // 作った字体（小さい）は断り、丸ごと（大きい）は受け付ける
    });
    const out = await e.embed(svgOf(text("'Gen Interface JP'", 'あ')));
    expect(calls).toBe(2);
    expect(out.length > 7_000_000).toBe(true); // 丸ごと（6MB → base64 で 8MB）
  });

  it('丸ごとも受け付けられなければ止める（黙って既定の字体で焼かない）', async () => {
    const e = new FontEmbedder(realBytes, async () => false);
    await expect(e.embed(svgOf(text("'Gen Interface JP'", 'あ')))).rejects.toThrow();
  });

  it('読めなかったときは覚えない（次は読み直す）', async () => {
    let n = 0;
    const load = vi.fn(async (s: FontSource) => {
      n += 1;
      if (n === 1) throw new Error('まだ無い');
      return realBytes(s);
    });
    const e = new FontEmbedder(load);
    await expect(e.embed(svgOf(text("'Gen Interface JP'", 'あ')))).rejects.toThrow();
    const out = await e.embed(svgOf(text("'Gen Interface JP'", 'あ')));
    expect(out.includes('@font-face')).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
