// 書き出し前の同梱フォント読み込み（ADR-0004・パリティ）。
//
// Canvas ラスタライズは**読み込み済みのフォントしか使えない**（`document.fonts.ready` は「まだ要求して
// いない webfont」を待たない）。画面に出ていない字体をそのまま焼くと、**プレビューと違う字**の動画が
// 出てしまうので、描き始める前に全部そろえる（どの部品がどの字体を使うかは描いてみるまで分からない）。
import { FONT_CATALOG } from '../../domain/font/fontCatalog';

/** 同梱フォントを全部読み込む（失敗しても描画側のフォールバックに任せて続ける）。 */
export async function loadExportFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await Promise.all(
      FONT_CATALOG.flatMap((f) => [
        document.fonts.load(`400 1em "${f.cssFamily}"`),
        document.fonts.load(`700 1em "${f.cssFamily}"`),
      ]),
    );
  } catch {
    /* 読込失敗時は描画側のフォールバックに任せる */
  }
}
