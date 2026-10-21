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

/**
 * 書き出しで焼く SVG に字体を埋め込む入れ物（ADR-0062）。字体ごとに作った「使う字だけの字体」を覚えておく。
 * ⚠️ **書き出しの始めに作り直す**（`resetExportFontEmbedder`）＝パックを入れ直すと同じ id でも中身が変わりうる。
 */
let embedder = new FontEmbedder(defaultFontBytesLoader);

/** 書き出しの始めに呼ぶ（`loadExportFonts`）。覚えた字体を捨てる。 */
export function resetExportFontEmbedder(): void {
  embedder = new FontEmbedder(defaultFontBytesLoader);
}

/** SVG文字列を canvas で PNG(data URL) に焼く。フォント確定を待ってから描画する。 */
export async function svgToPngDataUrl(svg: string, width: number, height: number): Promise<string> {
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
    throw new Error('動画の文字の形を読み込めませんでした。アプリを開き直してから、もう一度書き出してください。');
  }
  const blob = new Blob([withFonts], { type: 'image/svg+xml;charset=utf-8' });
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
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
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
