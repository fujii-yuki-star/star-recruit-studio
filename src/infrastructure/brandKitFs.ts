// ブランドキット（ADR-0036・#351）の保存/読込（Tauri コマンド境界・§4）。
// 保存先は appData/brandkit.json（全プロジェクト共通＝グローバル）。
// Tauri 非検出時（ブラウザ開発）は空・no-op（userTemplateFs と同方針）。
import { invoke } from '@tauri-apps/api/core';
import { emptyBrandKit, parseBrandKit, type BrandKit } from '../domain/brand/brandKit';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** ブランドキットを読む（無ければ空）。 */
export async function loadBrandKit(): Promise<BrandKit> {
  if (!isTauri()) return emptyBrandKit();
  try {
    const text = await invoke<string | null>('load_brand_kit');
    return text == null ? emptyBrandKit() : parseBrandKit(text);
  } catch {
    // 読めなくても画面は開ける（キットが無いのと同じ扱い）＝行き止まりにしない。
    return emptyBrandKit();
  }
}

/** ブランドキットを書く（丸ごと置き換え）。 */
export async function saveBrandKit(kit: BrandKit): Promise<void> {
  if (!isTauri()) return;
  await invoke('save_brand_kit', { kitJson: JSON.stringify(kit, null, 2) });
}
