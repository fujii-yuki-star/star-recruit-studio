// 同梱フォントのカタログ（フォント選択機能）。すべて SIL OFL 1.1＝同梱・再配布・商用可（13§6）。
// id は project.videoSettings.fontId の enum 値と一致させる（単一の参照元・§2-7）。
// cssFamily は @font-face（src/styles/fonts.css）の font-family 名と一致させる。
// 表示名（label）は選択UIで「その字形」で描画する（直感的に分かるように）。

/** 同梱フォントの id。project.schema の videoSettings.fontId enum と一致させる（単一参照元・§6 型注釈）。 */
export type FontId = 'gen-interface-jp' | 'gen-interface-jp-display' | 'kaitou-yokoku-gothic';

export interface BundledFont {
  /** project.videoSettings.fontId の値（schema enum と一致）。 */
  id: FontId;
  /** 選択UIに表示する名前（その字形で描画する）。 */
  label: string;
  /** @font-face の font-family 名（描画で使う）。 */
  cssFamily: string;
  /** 役割の補足（UIの説明文）。 */
  note: string;
}

/** 同梱フォント一覧（初期3種・段階的に追加予定）。 */
export const FONT_CATALOG: readonly BundledFont[] = [
  { id: 'gen-interface-jp', label: 'Gen Interface JP', cssFamily: 'Gen Interface JP', note: '標準（本文向け）' },
  { id: 'gen-interface-jp-display', label: 'Gen Interface JP Display', cssFamily: 'Gen Interface JP Display', note: '見出し向け' },
  { id: 'kaitou-yokoku-gothic', label: '怪盗予告ゴシック', cssFamily: 'Kaitou Yokoku Gothic', note: '演出・インパクト' },
];

/** 既定フォント（未指定・不明な fontId のフォールバック先）。 */
export const DEFAULT_FONT_ID: FontId = 'gen-interface-jp';

/** fontId → 描画用 font-family 文字列（同梱フォント＋sans-serif フォールバック）。不明/未指定は既定へ。 */
export function fontFamilyForId(fontId: string | null | undefined): string {
  const found =
    FONT_CATALOG.find((f) => f.id === fontId) ??
    FONT_CATALOG.find((f) => f.id === DEFAULT_FONT_ID)!;
  return `'${found.cssFamily}', sans-serif`;
}

/** fontId → @font-face の font-family 名（bare）。document.fonts.load 用。不明/未指定は既定。 */
export function cssFamilyForId(fontId: string | null | undefined): string {
  const found =
    FONT_CATALOG.find((f) => f.id === fontId) ??
    FONT_CATALOG.find((f) => f.id === DEFAULT_FONT_ID)!;
  return found.cssFamily;
}

/** 既知の fontId か（検証・移行のフォールバック判定用）。 */
export function isKnownFontId(fontId: unknown): boolean {
  return typeof fontId === 'string' && FONT_CATALOG.some((f) => f.id === fontId);
}

/**
 * 場面フォントの解決（null=継承）：場面の fontId（既知ならそれ）→ 動画全体の fontId（既知なら）→ 既定。
 * 未指定/不明は次段へフォールバックする（描画・書き出しで共通利用）。
 */
export function resolveFontId(
  sceneFontId: string | null | undefined,
  projectFontId: string | null | undefined,
): FontId {
  if (isKnownFontId(sceneFontId)) return sceneFontId as FontId;
  if (isKnownFontId(projectFontId)) return projectFontId as FontId;
  return DEFAULT_FONT_ID;
}
