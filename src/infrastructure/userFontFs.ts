// 持ち込みフォント（ADR-0038・#261）の保存/読込と、WebView への登録（Tauri コマンド境界・§4）。
//
// ⚠️ **フォントはプロジェクトに入れない**＝アプリが**再配布経路にならない**ようにする（`13 §6`）。
// 素材（ADR-0035）は「自己完結のためコピーする」が、フォントは**理由が逆**でコピーしない。
// ⚠️ **CSS の家族名は id そのもの**（`userFontCssFamily`）＝描く側に目録を配らない（`fontCatalog.ts` の ⚠️）。
import { invoke } from '@tauri-apps/api/core';
import { userFontCssFamily } from '../domain/font/fontCatalog';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 持ち込みフォント1つぶん（Rust の `UserFontEntry` と対応）。 */
export interface UserFont {
  id: string;
  fileName: string;
  displayName: string;
}

/** 取り込める形式（利用者決定＝4つとも・ADR-0038）。 */
export const USER_FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'] as const;

/** 持ち込みフォントの一覧（**実体があるものだけ**が返る）。 */
export async function listUserFonts(): Promise<UserFont[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<UserFont[]>('list_user_fonts');
  } catch {
    // 一覧が読めなくても画面は開ける（同梱フォントは使える）＝行き止まりにしない。
    return [];
  }
}

/** フォントを取り込む（利用者が選んだファイルをコピーする）。失敗は文言つきで投げる（§2-5）。 */
export async function importUserFont(fontId: string, displayName: string, srcPath: string): Promise<UserFont> {
  return invoke<UserFont>('import_user_font', { fontId, displayName, srcPath });
}

/** 持ち込みフォントを消す（実体と覚え書きの両方）。 */
export async function deleteUserFont(fontId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('delete_user_font', { fontId });
}

/**
 * このセッションで**登録済み**のフォント（二度読みしない）。
 * ⚠️ **文書には持たない**＝読み込んだかどうかは画面の都合で、動画の中身ではない。
 */
const registered = new Set<string>();

/** テスト用に登録の記憶を戻す（モジュールの状態はファイル内のテスト間で残るため）。 */
export function resetRegisteredUserFonts(): void {
  registered.clear();
}

/**
 * 持ち込みフォントを WebView へ登録する（`FontFace`）。**登録済みなら何もしない**。
 *
 * ⚠️ **中身をバイト列で渡す**＝`asset://` の URL を渡す手もあるが、バイト列なら
 * **読み込めたかどうかをその場で受け取れる**（CSP の `font-src` にも依存しない）。
 * ⚠️ **太字も同じ実体で登録する**＝1ファイルしか持たないので、太字を別に持てない。
 * 登録しないと `700` を要求したときにブラウザが**合成した太字**を使い、
 * プレビューと書き出しで太さが変わりうる（同じ実体を指しておけば必ず同じ絵になる）。
 */
export async function ensureUserFontLoaded(fontId: string): Promise<boolean> {
  if (!isTauri() || typeof document === 'undefined' || !document.fonts) return false;
  if (registered.has(fontId)) return true;
  try {
    const base64 = await invoke<string>('read_user_font', { fontId });
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const family = userFontCssFamily(fontId);
    for (const weight of ['400', '700']) {
      const face = new FontFace(family, bytes, { weight });
      await face.load();
      document.fonts.add(face);
    }
    registered.add(fontId);
    return true;
  } catch {
    // ⚠️ **ここでは断らない**＝描画は既定の字体へ倒れてよい（画面が真っ白にならない）。
    // 「違う字体のまま動画を出さない」ための断りは、公開前チェックと書き出しが持つ（ADR-0038）。
    return false;
  }
}

/** 一覧のフォントをまとめて登録する（設定画面・書き出し前に使う）。 */
export async function loadUserFonts(fontIds: readonly string[]): Promise<void> {
  await Promise.all(fontIds.map((id) => ensureUserFontLoaded(id)));
}
