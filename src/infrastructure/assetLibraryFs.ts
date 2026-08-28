// ユーザー素材ライブラリ（ADR-0035・#260）の保存/読込（Tauri コマンド境界・§4）。
// 保存先は appData/user_assets（全プロジェクト共通＝グローバル）。
// Tauri 非検出時（ブラウザ開発）は空・no-op＝開発フローを止めない（userTemplateFs と同方針）。
import { invoke } from '@tauri-apps/api/core';
import type { LibraryAsset } from '../domain/asset/assetLibrary';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** ライブラリの一覧（**実体があるものだけ**が返る）。 */
export async function listLibraryAssets(): Promise<LibraryAsset[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<LibraryAsset[]>('list_library_assets');
  } catch {
    // 一覧が読めなくても画面は開ける（プロジェクトの素材は使える）＝行き止まりにしない。
    return [];
  }
}

/** 素材をライブラリへ置く（利用者が選んだファイルをコピーする）。失敗は文言つきで投げる（§2-5）。 */
export async function addLibraryAsset(
  assetId: string,
  displayName: string,
  assetType: string,
  tags: readonly string[],
  srcPath: string,
): Promise<LibraryAsset> {
  return invoke<LibraryAsset>('add_library_asset', {
    assetId,
    displayName,
    assetType,
    tags: [...tags],
    srcPath,
  });
}

/**
 * ライブラリの素材を**プロジェクトへコピー**する（ADR-0035 決定3）。保存された相対パスを返す。
 * ⚠️ **参照ではなくコピー**＝別PCへ移しても全プロジェクトが同時に欠損しない（ADR-0024 決定6）。
 */
export async function copyLibraryAssetToProject(
  libraryAssetId: string,
  projectId: string,
  fileName: string,
): Promise<string> {
  return invoke<string>('copy_library_asset_to_project', { libraryAssetId, projectId, fileName });
}

/** ライブラリの素材を消す。⚠️ **既に取り込んだプロジェクトには影響しない**（コピーなので）。 */
export async function deleteLibraryAsset(assetId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('delete_library_asset', { assetId });
}

/** ライブラリの素材の名前・タグを直す（実体は触らない）。 */
export async function updateLibraryAsset(
  assetId: string,
  displayName: string,
  tags: readonly string[],
): Promise<void> {
  if (!isTauri()) return;
  await invoke('update_library_asset', { assetId, displayName, tags: [...tags] });
}
