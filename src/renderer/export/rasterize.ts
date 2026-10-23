// 静止レイヤーSVG → PNG(data URL)。プレビューと同一の WebView(Blink) で描くことでパリティを保証する（ADR-0004）。
// 出力(MP4)用に実寸（1920x1080）で焼く。素材画像は data URL でインライン済みのため canvas は汚染されない。
//
// ⚠️ **ここの断りは画面まで届く**（#1123・PR #1130 レビュー由来 🟡）＝書き出しの受け口は
// 関門（`src/app/userFacingError.ts`）を通すが、関門は **`Error` の `message` も読む**ので、
// **日本語＋句点の文はそのまま画面へ出る**。以前は受け口が `typeof e === "string"` で `Error` を
// 落としていたため、次の行動つきの既定文（`EXPORT_FAILED_TIMELINE`）が出ていた。
// **だからここの文にも「次の行動」を持たせる**（§2-5）＝原因だけの1文が既定文を追い出さないように。

import { FontEmbedder } from './embedFonts';
import { defaultFontBytesLoader } from './fontBytes';
import { encodePngLater } from './pngEncoder';

/**
 * 書き出しで焼く SVG に字体を埋め込む入れ物（ADR-0062）。字体ごとに作った「使う字だけの字体」を覚えておく。
 * ⚠️ **書き出しの始めに作り直す**（`resetExportFontEmbedder`）＝パックを入れ直すと同じ id でも中身が変わりうる。
 */
let embedder = new FontEmbedder(defaultFontBytesLoader);

/** 書き出しの始めに呼ぶ（`loadExportFonts`）。覚えた字体を捨てる。 */
export function resetExportFontEmbedder(): void {
  if (releaseTimer != null) clearTimeout(releaseTimer);
  releaseTimer = null;
  embedder = new FontEmbedder(defaultFontBytesLoader);
}

/**
 * **しばらく焼かなければ、覚えた字体を捨てる**（負荷・耐久の点検 2026-10-22）＝覚えているのは字体のファイル丸ごと
 * （日本語の字体は数 MB〜20MB 余り）と、使う字だけの字体。前は次の書き出しまで持ちっぱなしだった（書き出しの後も、
 * 見本の絵を1枚作っただけでも）。⚠️ 捨てても絵は変わらない＝次に焼くときに読み直して作り直すだけ
 * （同じ字体のファイルから同じ字の形を取る）。書き出しの間はコマが続けて来るので、途中で捨てることはまず無い。
 */
export const FONT_CACHE_IDLE_MS = 60_000;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFontRelease(): void {
  if (releaseTimer != null) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    embedder = new FontEmbedder(defaultFontBytesLoader);
  }, FONT_CACHE_IDLE_MS);
}

/** SVG文字列を canvas で PNG(data URL) に焼く。フォント確定を待ってから描画する。 */
export async function svgToPngDataUrl(svg: string, width: number, height: number): Promise<string> {
  return withDrawnCanvas(svg, width, height, async (canvas) => canvas.toDataURL('image/png'));
}

/**
 * SVG文字列を canvas で焼き、**PNG にするのは別スレッドへ渡す**（書き出しの高速化・2026-10-23）。
 * 描き終えた時点で返る（`bytes` は後で揃う）＝その間に次のコマを描ける。描く手順は `svgToPngDataUrl` と1つ。
 */
export async function svgToPngLater(svg: string, width: number, height: number): Promise<{ bytes: Promise<Uint8Array> }> {
  return withDrawnCanvas(svg, width, height, (canvas) => encodePngLater(canvas));
}

/** 字体を埋め込んだ SVG を canvas に描き、`encode` で取り出す（取り出し方だけ呼ぶ側が決める）。 */
async function withDrawnCanvas<T>(
  svg: string,
  width: number,
  height: number,
  encode: (canvas: HTMLCanvasElement) => Promise<T>,
): Promise<T> {
  if (typeof document === 'undefined') {
    throw new Error('動画の絵を作れませんでした。アプリを開き直してから、もう一度お試しください。');
  }
  // 同梱フォントのロード完了を待つ（テキスト描画のパリティ）。
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // フォントAPIが使えない環境でも描画は続行する
    }
  }
  // ⚠️ **字体を SVG の中へ埋め込む**（ADR-0062）＝`<img>` に読ませた SVG は文書の字体を使えず、
  //   埋め込まないと Windows に無い字体（同梱・持ち込み・パックのすべて）が既定の字体で焼かれる。
  // ⚠️ **読めなければ止める**＝黙って別の字体の動画を成功として出さない（ADR-0026④）。
  let withFonts: string;
  try {
    withFonts = await embedder.embed(svg);
  } catch {
    scheduleFontRelease();
    throw new Error('動画の文字の形を読み込めませんでした。アプリを開き直してから、もう一度書き出してください。');
  }
  scheduleFontRelease();
  const blob = svgBlob(withFonts);
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('動画の絵を作れませんでした。パソコンを再起動してから、もう一度お試しください。');
    }
    ctx.drawImage(img, 0, 0, width, height);
    return await encode(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** `from` から先で `ch` が出る位置（無ければ文字列の終わり）。 */
function endAt(svg: string, ch: string, from: number): number {
  const j = svg.indexOf(ch, from);
  return j < 0 ? svg.length : j;
}

/** これより長い data URL は、前のコマで作った Blob の部品を使い回す（書き出しの高速化・2026-10-23）。 */
export const BLOB_PART_REUSE_MIN_CHARS = 64 * 1024;
/** 前のコマで使った大きな data URL → その Blob の部品（使わなくなったものはコマごとに捨てる）。 */
let blobParts = new Map<string, Blob>();

/**
 * SVG の文字列を Blob にする。⚠️ **中身は `new Blob([svg])` とバイトまで同じ**＝部品の並べ方を変えるだけ。
 *
 * 1コマの SVG は約 6MB で、その大半は**毎コマ同じ絵の data URL**（立ち絵・背景）だった（実測）。Blob にするたびに
 * 文字を UTF-8 へ直して写すので、主スレッドの約2割がここだった。大きな data URL は前のコマで作った部品を使い回す
 * （同じ文字列なら同じバイト＝data URL は ASCII だけ）。⚠️ 覚えるのは**直前のコマで使ったものだけ**＝増え続けない。
 */
export function svgBlob(svg: string): Blob {
  const parts: BlobPart[] = [];
  const next = new Map<string, Blob>();
  let at = 0;
  for (let i = svg.indexOf('data:'); i >= 0; i = svg.indexOf('data:', i + 1)) {
    // data URL は引用符か括弧で終わる（`href="…"`・`url(…)`）。⚠️ 1文字ずつ見ない＝数 MB を JS で回すと
    // それだけで主スレッドの1割を超えた（実測）。組み込みの `indexOf` で探す。
    const end = Math.min(endAt(svg, '"', i), endAt(svg, "'", i), endAt(svg, ')', i));
    if (end - i >= BLOB_PART_REUSE_MIN_CHARS) {
      const url = svg.slice(i, end);
      const part = next.get(url) ?? blobParts.get(url) ?? new Blob([url]);
      next.set(url, part);
      if (i > at) parts.push(svg.slice(at, i));
      parts.push(part);
      at = end;
    }
    i = end;
  }
  if (at < svg.length) parts.push(at === 0 ? svg : svg.slice(at));
  blobParts = next;
  return new Blob(parts, { type: 'image/svg+xml;charset=utf-8' });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(
      new Error('動画の絵を作れませんでした。もう一度お試しください。何度も失敗するときは、設定の「記録の場所を開く」から記録をお送りください。'),
    );
    img.src = src;
  });
}
