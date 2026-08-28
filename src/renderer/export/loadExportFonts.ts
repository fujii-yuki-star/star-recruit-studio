// 書き出し前の同梱フォント読み込み（ADR-0004・パリティ）。
//
// Canvas ラスタライズは**読み込み済みのフォントしか使えない**（`document.fonts.ready` は「まだ要求して
// いない webfont」を待たない）。画面に出ていない字体をそのまま焼くと、**プレビューと違う字**の動画が
// 出てしまうので、描き始める前に全部そろえる（どの部品がどの字体を使うかは描いてみるまで分からない）。
import { FONT_CATALOG } from '../../domain/font/fontCatalog';
import { listUserFonts, loadUserFonts } from '../../infrastructure/userFontFs';

/**
 * 書き出しに使いうるフォントを全部読み込む（失敗しても描画側のフォールバックに任せて続ける）。
 *
 * ⚠️ **持ち込みフォント（ADR-0038・#261）も同じ入口で読む**＝ここを通らない字体は焼けない。
 * 読めなかったフォントを**使っている**動画は、書き出しの手前で断る（`missingUserFonts`＝
 * 黙って別の字体の動画を成功として出さない・§2-5）。
 */
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
  // 持ち込みフォントは `FontFace` として登録する（同梱と違い `@font-face` の宣言が無い）。
  try {
    await loadUserFonts((await listUserFonts()).map((f) => f.id));
  } catch {
    /* 同上 */
  }
}
