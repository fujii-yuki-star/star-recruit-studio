// 静止レイヤーSVG → PNG(data URL)。プレビューと同一の WebView(Blink) で描くことでパリティを保証する（ADR-0004）。
// 出力(MP4)用に実寸（1920x1080）で焼く。素材画像は data URL でインライン済みのため canvas は汚染されない。

/** SVG文字列を canvas で PNG(data URL) に焼く。フォント確定を待ってから描画する。 */
export async function svgToPngDataUrl(svg: string, width: number, height: number): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('画像化はアプリ内でのみ実行できます。');
  }
  // 同梱フォントのロード完了を待つ（テキスト描画のパリティ）。
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // フォントAPIが使えない環境でも描画は続行する
    }
  }
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('画像化に必要な機能を利用できません。');
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
    img.onerror = () => reject(new Error('画像の生成に失敗しました。'));
    img.src = src;
  });
}
