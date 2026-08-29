// 同梱フォントのカタログ（フォント選択機能）。すべて SIL OFL 1.1＝同梱・再配布・商用可（13§6）。
// id は project.videoSettings.fontId の enum 値と一致させる（単一の参照元・§2-7）。
// cssFamily は @font-face（src/styles/fonts.css）の font-family 名と一致させる。
// 表示名（label）は選択UIで「その字形」で描画する（直感的に分かるように）。

/**
 * フォントの id（同梱＋持ち込み・ADR-0038・#261）。
 *
 * ⚠️ **enum ではなく「形」で縛る**＝持ち込みフォント（`user_font_NNN`）は利用者ごとに増えるので、
 * 値を数え上げられない。schema も `enum` から `pattern` へ変えてある（`11 §7.1.1`）。
 * 同梱は `BUNDLED_FONT_IDS` の3つ。
 */
export type FontId = string;

/** 同梱フォントの id（schema の pattern に列挙してあるもの＝単一の参照元・§2-7）。 */
export type BundledFontId = 'gen-interface-jp' | 'gen-interface-jp-display' | 'kaitou-yokoku-gothic';

export interface BundledFont {
  /** project.videoSettings.fontId の値（schema の pattern に列挙）。 */
  id: BundledFontId;
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
export const DEFAULT_FONT_ID: BundledFontId = 'gen-interface-jp';

/**
 * 持ち込みフォントの id の形（ADR-0038・#261）。`asset_NNN` と同じ流儀の3桁ゼロ詰め（`11 §2`）。
 * ⚠️ **schema の pattern と一致させる**（片方だけ変えると保存できるのに読めない、が起きる）。
 */
export const USER_FONT_ID_RE = /^user_font_[0-9]{3,}$/;

/**
 * 形の突き合わせに使う入力の一覧（α-6 出口監査 🔴5）。
 *
 * ⚠️ **同じ規則が3か所にある**＝`USER_FONT_ID_RE`（domain）・`$defs/FontId` の pattern（schema）・
 * `is_user_font_id`（Rust・パストラバーサル防止も兼ねる）。**片方だけ変えると保存できるのに読めない**
 * ので、3つが**同じ入力で同じ答え**になることを両側のテストで固定する（`lib_asset_NNN` と同じ形）。
 */
export const USER_FONT_ID_SAMPLES: readonly string[] = [
  'user_font_001',
  'user_font_1000',
  'user_font_1', // 3桁ゼロ詰めでない
  'user_font_00a', // 数字でない
  'xuser_font_001', // 前に付いている
  'user_font_001x', // 後ろに付いている
  'user_font_', // 番号が無い
  'gen-interface-jp', // 同梱（持ち込みではない）
  '', // 空
];

/** 持ち込みフォントの id か（形だけを見る＝ファイルがあるかは別の話）。 */
export function isUserFontId(fontId: unknown): fontId is FontId {
  return typeof fontId === 'string' && USER_FONT_ID_RE.test(fontId);
}

/**
 * 次の持ち込みフォント id を採る（`11 §2` の採番＝既存の最大＋1・3桁ゼロ詰め）。
 * ⚠️ **消した番号は使い回さない**＝`existingIds` には **これまでに使った番号**（外したものを含む＝
 * `usedUserFontIds()`）を渡すこと。**一覧は渡さない**（実体があるものだけなので最大番号を外すと
 * 同じ番号が再発行され、その番号を指している動画が黙って別のものになる＝α-6 出口監査 🟡8）。
 */
export function createUserFontId(existingIds: readonly string[]): string {
  const max = existingIds.reduce((m, id) => {
    const n = isUserFontId(id) ? Number(id.slice('user_font_'.length)) : 0;
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `user_font_${String(max + 1).padStart(3, '0')}`;
}

/**
 * 持ち込みフォントの **CSS の家族名は id そのもの**（ADR-0038 実装判断）。
 *
 * ⚠️ **描く側に一覧を持ち込まない**ため＝`fontFamilyForId` は描画のあちこちから**同期で**呼ばれる。
 * 家族名を目録から引く形にすると、目録を描画経路すべてへ配らねばならず、配り忘れた所だけ
 * **別の字体で描かれる**（この α-6 で何度も踏んだ「片方だけ漏れる」）。id を家族名にすれば引く必要が無い。
 * 登録（`FontFace`）も同じ名前で行う＝名前の対応表が要らない。
 */
export function userFontCssFamily(fontId: string): string {
  return fontId;
}

/** fontId → 描画用 font-family 文字列（同梱フォント＋sans-serif フォールバック）。不明/未指定は既定へ。 */
export function fontFamilyForId(fontId: string | null | undefined): string {
  return `'${cssFamilyForId(fontId)}', sans-serif`;
}

/** fontId → @font-face の font-family 名（bare）。document.fonts.load 用。不明/未指定は既定。 */
export function cssFamilyForId(fontId: string | null | undefined): string {
  const bundled = FONT_CATALOG.find((f) => f.id === fontId);
  if (bundled) return bundled.cssFamily;
  // 持ち込みフォントは id がそのまま家族名（上の ⚠️）。**ファイルの有無はここでは見ない**＝
  // 見つからないときの断りは公開前チェックと書き出しが出す（描画は既定へ倒れる・ADR-0038）。
  if (isUserFontId(fontId)) return userFontCssFamily(fontId);
  return FONT_CATALOG.find((f) => f.id === DEFAULT_FONT_ID)!.cssFamily;
}

/**
 * 既知の fontId か（検証・移行のフォールバック判定用）。
 * ⚠️ **持ち込みフォントは「形」で既知とみなす**（ADR-0038）＝ファイルが見つからないことと、
 * id が壊れていることは**別の壊れ方**。前者は書き出しの手前で断る（黙って別の字体にしない）、
 * 後者は読込時に既定へ落とす（従来どおり）。
 *
 * ⚠️ **型を狭める述語にしてある**（#351）＝呼ぶ側が `as FontId` を書かずに済む
 *（キャストは検査を素通りさせるので、`unknown` から入る経路〔ブランドキットの読込〕で効く）。
 */
export function isKnownFontId(fontId: unknown): fontId is FontId {
  return (
    (typeof fontId === 'string' && FONT_CATALOG.some((f) => f.id === fontId)) || isUserFontId(fontId)
  );
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
