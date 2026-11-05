// @vitest-environment jsdom
// SVG を Blob にするとき、大きな data URL の部品を前のコマから使い回す（書き出しの高速化 2026-10-23）。
// ⚠️ **中身は `new Blob([svg])` とバイトまで同じ**でなければならない（違えば絵が変わる）。
import { describe, expect, it, vi } from 'vitest';
import { BLOB_PART_REUSE_MIN_CHARS, svgBlob } from './rasterize';

const big = (ch: string) => `data:image/png;base64,${ch.repeat(BLOB_PART_REUSE_MIN_CHARS)}`;
// ⚠️ 比べるのは Buffer の equals（toEqual で 20 万要素を1つずつ比べると時間切れになる）。
const sameBytes = async (a: Blob, b: Blob) => Buffer.from(await a.arrayBuffer()).equals(Buffer.from(await b.arrayBuffer()));

describe('svgBlob', () => {
  it('中身は丸ごと Blob にしたときとバイトまで同じ（大きな data URL・小さな data URL・字体・日本語）', async () => {
    const svg = `<svg><text>日本語</text><image href="${big('A')}"/><image href='data:image/png;base64,QUJD'/>`
      + `<style>@font-face{src:url(${big('B')})}</style><image href="${big('A')}"/></svg>`;
    expect(await sameBytes(svgBlob(svg), new Blob([svg]))).toBe(true);
    expect(svgBlob(svg).type).toBe('image/svg+xml;charset=utf-8');
  });

  it('でたらめな並びでも同じバイト（200通り）', async () => {
    let seed = 11;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const pieces = ['<g>', 'あ', `href="${big('C')}"`, "href='data:x'", `url(${big('D')})`, 'data:', ')', '"', `"${big('E').slice(0, 100)}"`];
    for (let k = 0; k < 200; k += 1) {
      const svg = Array.from({ length: 1 + rnd(7) }, () => pieces[rnd(pieces.length)]).join('');
      expect(await sameBytes(svgBlob(svg), new Blob([svg])), svg.slice(0, 80)).toBe(true);
    }
  });

  it('次のコマでも同じ大きな data URL なら、部品を作り直さない（使わなくなったものは覚えない）', () => {
    const made: unknown[] = [];
    const Orig = Blob;
    const spy = vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts?: BlobPart[], opt?: BlobPropertyBag) {
      made.push(parts);
      return new Orig(parts, opt);
    } as never);
    try {
      const a = `<svg><image href="${big('F')}"/></svg>`;
      svgBlob(a);
      const first = made.length; // 部品1つ＋全体1つ
      svgBlob(a);
      expect(made.length - first, '同じ絵の部品を作り直した').toBe(1); // 全体だけ
      svgBlob(`<svg><image href="${big('G')}"/></svg>`);
      svgBlob(a);
      expect(made.length - first, '使わなくなった部品を覚え続けている').toBe(1 + 2 + 2);
    } finally {
      spy.mockRestore();
    }
  });
});
