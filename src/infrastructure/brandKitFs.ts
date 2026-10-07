// ブランドキット（ADR-0036・#351）の保存/読込（Tauri コマンド境界・§4）。
// 保存先は appData/brandkit.json（全プロジェクト共通＝グローバル）。
// Tauri 非検出時（ブラウザ開発）は空・no-op（userTemplateFs と同方針）。
import { invoke } from '@tauri-apps/api/core';
import { emptyBrandKit, parseBrandKit, type BrandKit } from '../domain/brand/brandKit';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * ブランドキットを読む（無ければ空）。**`null` ＝読めなかった**（「何も覚えていない」とは別）。
 *
 * ⚠️ **空に潰さない**（差分再監査 3巡目 🟡）＝空を見せた直後の `updateBrandKit` が**そのまま
 * 上書き**して、覚えていた字体・色・ロゴが消える。目録（`parse_manifest`）も読み方辞書も、
 * 同じ状況では**断ってファイルを守る**（ADR-0026②）。α-6 で3回直した「読めなかった≠1つも無い」
 *（`listUserFonts`／`listLibraryAssets`／設定画面の表示）の取り残し。
 */
export async function loadBrandKit(): Promise<BrandKit | null> {
  if (!isTauri()) return emptyBrandKit();
  try {
    const text = await invoke<string | null>('load_brand_kit');
    return text == null ? emptyBrandKit() : parseBrandKit(text); // `null`＝読めなかった（空とは区別する）
  } catch {
    // 読めなくても画面は開ける（行き止まりにしない）＝ただし**空とは区別する**。
    return null;
  }
}

/** ブランドキットを書く（丸ごと置き換え）。 */
export async function saveBrandKit(kit: BrandKit): Promise<void> {
  if (!isTauri()) return;
  await invoke('save_brand_kit', { kitJson: JSON.stringify(kit, null, 2) });
}
