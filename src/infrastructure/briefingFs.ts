// あなた向け会社説明の登録（β・ADR-0061 決定2）の保存/読込（Tauri コマンド境界・§4）。
// 保存先は appData/extensions/personalized-briefing/catalog.json（`11 §7.8`）。
// Tauri 非検出時（ブラウザ開発）は例の項目つきの登録・保存は no-op（brandKitFs と同じ方針）。
import { invoke } from '@tauri-apps/api/core';
import { defaultBriefingCatalog, isBriefingCatalog, type BriefingCatalog } from '../domain/briefing/catalog';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 登録を読む（無ければ例の項目つきの登録）。**`null` ＝読めなかった**（「まだ何も登録していない」とは別）。
 *
 * ⚠️ **例の登録に潰さない**＝読めなかった・形が違うのに例の登録を見せると、その次の保存が**登録を丸ごと上書き**する
 *（ブランドキットと同じ「読めなかった≠1つも無い」）。
 */
export async function loadBriefingCatalog(): Promise<BriefingCatalog | null> {
  if (!isTauri()) return defaultBriefingCatalog();
  try {
    const text = await invoke<string | null>('briefing_catalog_load');
    if (text == null) return defaultBriefingCatalog();
    const data: unknown = JSON.parse(text);
    return isBriefingCatalog(data) ? data : null;
  } catch {
    return null;
  }
}

/** 登録を書く（丸ごと置き換え）。⚠️ 正典の形を満たさないものは書かない（次に開けないファイルを作らない）。 */
export async function saveBriefingCatalog(catalog: BriefingCatalog): Promise<void> {
  if (!isTauri()) return;
  if (!isBriefingCatalog(catalog)) throw new Error('briefing catalog does not match the schema');
  await invoke('briefing_catalog_save', { catalogJson: JSON.stringify(catalog, null, 2) });
}
