// テンプレ所有素材（ADR-0021）の保存/読込/削除（Tauri コマンド境界・§4）。
// 保存先は appData/user_templates/assets/<tmpl_asset_NNN>.<ext>（全プロジェクト共通＝グローバル）。
// 表示用 URL は data URL（asset:// は使わない＝scope/キャッシュの実機未検証リスク回避・ADR-0021 PR B）。
// 非 Tauri（ブラウザ開発）は no-op／空（userTemplateFs・assetFs と同方針＝開発フローを止めない）。
import { invoke } from '@tauri-apps/api/core';
import { createTemplateAssetId } from '../domain/template/templateAsset';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** ファイルの拡張子（小文字・ドットなし）。ファイル名を優先し、無ければ mime、どちらも無ければ png。 */
export function fileExt(name: string, type: string): string {
  const fromName = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (fromName) return fromName;
  const fromType = type.split('/')[1]?.toLowerCase();
  return fromType || 'png';
}

/** File を data URL 文字列に読む（取り込み時に Rust へ渡す本体）。 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * テンプレ所有素材を取り込み、採番した `tmpl_asset_NNN` id を返す（非 Tauri・失敗は null）。
 * existingIds には現存するテンプレ素材 id を渡す（グローバル一意の採番）。
 */
export async function importTemplateAsset(file: File, existingIds: readonly string[]): Promise<string | null> {
  if (!isTauri()) return null;
  const assetId = createTemplateAssetId(existingIds);
  const fileName = `${assetId}.${fileExt(file.name, file.type)}`;
  const dataBase64 = await readAsDataUrl(file);
  try {
    await invoke('import_template_asset', { fileName, dataBase64 });
    return assetId;
  } catch (e) {
    console.warn('[templateAssetFs] テンプレ素材の保存に失敗しました:', e);
    return null;
  }
}

/** テンプレ所有素材を全件読み、assetId→data URL のマップで返す（非 Tauri・失敗は空）。 */
export async function loadTemplateAssetUrls(): Promise<Record<string, string>> {
  if (!isTauri()) return {};
  try {
    const pairs = await invoke<[string, string][]>('load_template_assets');
    const out: Record<string, string> = {};
    for (const [id, url] of pairs) out[id] = url;
    return out;
  } catch (e) {
    console.warn('[templateAssetFs] テンプレ素材の読み込みに失敗しました（空で続行）:', e);
    return {};
  }
}

/** テンプレ所有素材(<assetId>.*)を削除する（Tauri のみ・非 Tauri は no-op）。テンプレ削除時の掃除に使う。 */
export async function deleteTemplateAsset(assetId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('delete_template_asset', { assetId });
  } catch (e) {
    console.warn('[templateAssetFs] テンプレ素材の削除に失敗しました:', e);
  }
}
