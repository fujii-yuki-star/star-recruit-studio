// 使う字の形だけを残した字体（ADR-0062）。同梱の本物の字体で確かめる（作り物の字体では表の入り組みを試せない）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cmapLookup, readTables, subsetFontKeepingTables } from './fontSubset';

const font = (name: string): Uint8Array => new Uint8Array(readFileSync(`public/fonts/${name}`));
const cps = (text: string): number[] => [...text].map((c) => c.codePointAt(0)!);

/** 字の形の長さ（loca から）。 */
function glyphLengths(b: Uint8Array): number[] {
  const t = readTables(b)!;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint16(t.get('maxp')!.offset + 4);
  const long = v.getInt16(t.get('head')!.offset + 50) === 1;
  const loca = t.get('loca')!.offset;
  const at = (g: number): number => (long ? v.getUint32(loca + g * 4) : v.getUint16(loca + g * 2) * 2);
  return Array.from({ length: n }, (_, g) => at(g + 1) - at(g));
}

/** 字の形の中身（バイト列）。 */
function glyphBytes(b: Uint8Array, g: number): Uint8Array {
  const t = readTables(b)!;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const long = v.getInt16(t.get('head')!.offset + 50) === 1;
  const loca = t.get('loca')!.offset;
  const at = (i: number): number => (long ? v.getUint32(loca + i * 4) : v.getUint16(loca + i * 2) * 2);
  const glyf = t.get('glyf')!.offset;
  return b.subarray(glyf + at(g), glyf + at(g + 1));
}

function tableBytes(b: Uint8Array, tag: string): Uint8Array {
  const t = readTables(b)!.get(tag)!;
  return b.subarray(t.offset, t.offset + t.length);
}

describe('subsetFontKeepingTables（Gen Interface JP）', () => {
  const src = font('GenInterfaceJP-Regular.ttf');
  const text = 'テキストあいう、すたりおの動画。ABC fi 123';
  const out = subsetFontKeepingTables(src, cps(text))!;
  const srcLook = cmapLookup(src, readTables(src)!);

  it('字の番号は変えず、使う字の形は元と同じバイト列・使わない字は空', () => {
    expect(out).not.toBeNull();
    const before = glyphLengths(src);
    const after = glyphLengths(out);
    expect(after.length).toBe(before.length);
    for (const ch of text) {
      const g = srcLook(ch.codePointAt(0)!);
      if (g === 0) continue;
      // 4 バイトにそろえた詰め物の分だけ長い＝先頭は元と同じ・残りは 0
      const a = glyphBytes(out, g);
      const b = glyphBytes(src, g);
      expect(a.subarray(0, b.length)).toEqual(b);
      expect([...a.subarray(b.length)].every((x) => x === 0)).toBe(true);
    }
    const unused = srcLook('龍'.codePointAt(0)!);
    expect(before[unused]).toBeGreaterThan(0);
    expect(after[unused]).toBe(0);
    expect(after[0]).toBe((before[0] + 3) & ~3); // .notdef は残す（4 バイトにそろえた長さ）
  });

  it('詰め・置き換え・字幅・文字の表はそのまま（字の番号を付け直さないので合う）', () => {
    for (const tag of ['cmap', 'GPOS', 'GSUB', 'hmtx', 'hhea', 'OS/2', 'vmtx']) {
      expect(tableBytes(out, tag)).toEqual(tableBytes(src, tag));
    }
  });

  it('字の名前（post）は 3.0 に・loca は長い形に', () => {
    const post = new DataView(tableBytes(out, 'post').slice().buffer);
    expect(post.getUint32(0)).toBe(0x00030000);
    const head = new DataView(tableBytes(out, 'head').slice().buffer);
    expect(head.getInt16(50)).toBe(1);
  });

  it('字体全体の検査和が合う（head の checkSumAdjustment）', () => {
    const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
    let sum = 0;
    for (let i = 0; i < out.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
  });

  it('小さくなる（6MB → 1MB 未満）', () => {
    expect(src.length).toBeGreaterThan(5_000_000);
    expect(out.length).toBeLessThan(1_000_000);
  });

});

describe('subsetFontKeepingTables（怪盗予告ゴシック＝字の形の数が多い）', () => {
  // 怪盗予告ゴシックは「fi」「ffl」を合字（liga）にする＝合字の字の形は cmap に無い。辿らないと書き出しで字が消える。
  it('置き換え（GSUB）で出てくる字の形も残す＝ cmap に無い合字の形が足される', () => {
    const src = font('KaitouYokokuGothic.ttf');
    const look = cmapLookup(src, readTables(src)!);
    const text = 'fi ffl';
    const encoded = new Set(cps(text).map(look));
    const kept = glyphLengths(subsetFontKeepingTables(src, cps(text))!)
      .map((l, g) => [l, g] as const)
      .filter(([l, g]) => l > 0 && g !== 0 && !encoded.has(g));
    expect(kept.length).toBeGreaterThan(0);
    // 置き換えを辿らないと、その字は残らない
    const none = glyphLengths(subsetFontKeepingTables(src, cps(text), [])!).filter((l) => l > 0).length;
    const withGsub = glyphLengths(subsetFontKeepingTables(src, cps(text))!).filter((l) => l > 0).length;
    expect(withGsub).toBeGreaterThan(none);
  });

  it('21MB の字体でも 2.5MB 未満', () => {
    const src = font('KaitouYokokuGothic.ttf');
    const out = subsetFontKeepingTables(src, cps('テキストあいう、すたりおの動画。'))!;
    expect(src.length).toBeGreaterThan(20_000_000);
    expect(out.length).toBeLessThan(2_500_000);
  });
});

describe('subsetFontKeepingTables（合字は部品が揃うときだけ）', () => {
  // 「f」だけなら「fi」の合字は出てこない＝残さない（残すと、使わない字の形で字体が膨らむ）。
  it('「fi」を使うときだけ fi の合字を残す', () => {
    const src = font('KaitouYokokuGothic.ttf');
    const look = cmapLookup(src, readTables(src)!);
    const added = (text: string): Set<number> => {
      const encoded = new Set(cps(text).map(look));
      return new Set(glyphLengths(subsetFontKeepingTables(src, cps(text))!)
        .map((l, g) => [l, g] as const).filter(([l, g]) => l > 0 && g !== 0 && !encoded.has(g)).map(([, g]) => g));
    };
    const onlyF = added('f');
    const fi = added('fi');
    expect([...fi].some((g) => !onlyF.has(g))).toBe(true);
  });
});

describe('subsetFontKeepingTables（扱わない字体）', () => {
  it('glyf を持たない字体（CFF の OTF）・字体でないものは null（呼ぶ側が丸ごと使う）', () => {
    const otf = new Uint8Array(12);
    otf.set([0x4f, 0x54, 0x54, 0x4f]); // 'OTTO'・表 0 個
    expect(subsetFontKeepingTables(otf, cps('あ'))).toBeNull();
    expect(subsetFontKeepingTables(new Uint8Array(3), cps('あ'))).toBeNull();
  });
});
