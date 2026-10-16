// 書き出しで埋め込む字体の実体を読む（ADR-0062）。仕上がり確認が使うのと同じ実体。
// 同梱は `public/fonts/`（`src/styles/fonts.css` と同じファイル）、持ち込み・パックは今の読み口（`readFontBase64`）。
import { readFontBase64 } from '../../infrastructure/userFontFs';
import type { FontSource } from './embedFonts';

export async function defaultFontBytesLoader(source: FontSource): Promise<Uint8Array> {
  if (source.kind === 'bundled') {
    const res = await fetch(`/fonts/${source.file}`);
    if (!res.ok) throw new Error(`bundled font ${source.file}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  const base64 = await readFontBase64(source.fontId);
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
