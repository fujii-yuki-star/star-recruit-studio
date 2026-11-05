// @vitest-environment jsdom
// 書き出しの焼き口は、焼く前に字体を SVG へ埋め込む（ADR-0062）。
// ⚠️ 埋め込まないと、`<img>` に読ませた SVG は Windows に無い字体をすべて既定の字体で焼く（実機で確かめた）。
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FONT_CACHE_IDLE_MS, resetExportFontEmbedder, svgToPngDataUrl } from './rasterize';

let blobs: Blob[] = [];

beforeEach(() => {
  blobs = [];
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
    blobs.push(b as Blob);
    return 'blob:x';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => undefined } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const file = url.replace(/^\/fonts\//, '');
    const bytes = readFileSync(`public/fonts/${file}`);
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  }));
  resetExportFontEmbedder();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text x="0" y="0" font-family="'Kaitou Yokoku Gothic', sans-serif" font-size="20" font-weight="normal">怪盗</text></svg>`;

describe('svgToPngDataUrl（字体の埋め込み・ADR-0062）', () => {
  it('焼く SVG に、使う字だけの字体が @font-face で入っている', async () => {
    await svgToPngDataUrl(svg, 10, 10);
    expect(blobs).toHaveLength(1);
    const text = await blobs[0]!.text();
    expect(text).toMatch(/<defs><style>@font-face\{font-family:"Kaitou Yokoku Gothic";src:url\(data:font\/ttf;base64,/);
    expect(text.length).toBeLessThan(4_000_000); // 21MB の字体を丸ごと入れていない
  });

  it('字体を読めなければ、焼かずに次の行動つきで断る（黙って既定の字体で焼かない）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })));
    resetExportFontEmbedder();
    await expect(svgToPngDataUrl(svg, 10, 10)).rejects.toThrow(/文字の形を読み込めませんでした。.*書き出してください。/);
    expect(blobs).toHaveLength(0);
  });
});

// ⚠️ **しばらく焼かなければ、覚えた字体を捨てる**（負荷・耐久の点検 2026-10-22）＝前は次の書き出しまで
//   字体のファイル丸ごと（数 MB〜20MB 余り）を持ちっぱなしだった。捨てても次に焼くときに読み直すだけ。
describe('覚えた字体の後片づけ', () => {
  it('続けて焼く間は読み直さず、しばらく焼かなければ捨てる（次は読み直す）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      set src(_v: string) { void Promise.resolve().then(() => this.onload?.()); }
    });
    try {
      const fetched = vi.mocked(fetch);
      await svgToPngDataUrl(svg, 10, 10);
      const first = fetched.mock.calls.length;
      expect(first).toBeGreaterThan(0);
      vi.advanceTimersByTime(FONT_CACHE_IDLE_MS - 1_000);
      await svgToPngDataUrl(svg, 10, 10);
      expect(fetched.mock.calls.length, "続けて焼くのに読み直した").toBe(first);
      // 最後に焼いてから数え直す＝少し前に焼いたばかりなので、まだ捨てない。
      vi.advanceTimersByTime(FONT_CACHE_IDLE_MS - 1_000);
      await svgToPngDataUrl(svg, 10, 10);
      expect(fetched.mock.calls.length, "使っている最中に捨てた").toBe(first);
      vi.advanceTimersByTime(FONT_CACHE_IDLE_MS);
      await svgToPngDataUrl(svg, 10, 10);
      expect(fetched.mock.calls.length, "しばらく焼かなくても捨てていない").toBe(first * 2);
    } finally {
      vi.useRealTimers();
    }
  });
});
