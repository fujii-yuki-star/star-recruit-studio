// 拡張パック（ADR-0060）の読み書き＝Rust の `packs.rs` を呼ぶだけ（照合と展開は Rust・形の確かめは domain）。
import { invoke } from '@tauri-apps/api/core';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 入れる前に中を見る＝manifest の文字だけ（展開しない）。 */
export async function inspectPack(path: string): Promise<string> {
  return invoke<string>('pack_inspect', { path });
}

/**
 * 照合して入れる（同じ packId は置き換え）。`shownManifest` は**利用者に見せた manifest の文字そのもの**＝
 * 見せてから入れるまでにファイルが差し替わっていたら Rust が断る（見せたものと違う中身を入れない）。
 */
export async function installPack(path: string, packId: string, shownManifest: string): Promise<void> {
  await invoke('pack_install', { path, packId, shownManifest });
}

/** 入っているパックの manifest の文字。ブラウザでの開発中は空。 */
export async function listPackManifests(): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>('pack_list');
}

/** 外す。 */
export async function uninstallPack(packId: string): Promise<void> {
  await invoke('pack_uninstall', { packId });
}

/** 中の文字のファイル（見た目パターンの JSON）。 */
export async function readPackText(packId: string, rel: string): Promise<string> {
  return invoke<string>('pack_read_text', { packId, rel });
}

/** 中の絵（既定素材）を data URL で。 */
export async function readPackDataUrl(packId: string, rel: string): Promise<string> {
  return invoke<string>('pack_read_data_url', { packId, rel });
}
