// 素材ファイルの取り込み/読み出し（Tauriコマンド境界）。domain は型のみ、I/Oはここに隔離（CLAUDE.md §4）。
// Tauri 非検出時（ブラウザ開発）は永続化せず null を返す（表示用 data URL はメモリ内で別途保持される）。
import { invoke } from '@tauri-apps/api/core';
import type { AssetMetadata } from '../domain/project/types';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 画像(data URL)をプロジェクトに取り込み、プロジェクト相対 filePath を返す。Tauri 非検出時は null（非永続）。 */
export async function importAssetFile(
  projectId: string,
  fileName: string,
  dataUrl: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string>('import_asset', { projectId, fileName, dataBase64: dataUrl });
}

/**
 * 素材を生バイト（raw IPC body）で取り込む。base64 を経由しないので大きい動画でもメモリを食わない。
 * Tauri v2: payload に Uint8Array、メタ情報は headers で渡す。Tauri 非検出時は null（非永続）。
 */
export async function importAssetBytes(
  projectId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string>('import_asset_bytes', bytes, { headers: { projectId, fileName } });
}

/** プロジェクト相対パスの素材を data URL で読む。Tauri 非検出 or 失敗（未配置のサンプル等）時は null。 */
export async function readAssetDataUrl(projectId: string, relPath: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>('read_asset_data_url', { projectId, relPath });
  } catch {
    return null;
  }
}

/** 動画素材のメタ情報（長さ・音声有無・解像度）を取得する。Tauri 非検出 or 失敗時は null。 */
export async function probeVideo(projectId: string, relPath: string): Promise<AssetMetadata | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<AssetMetadata>('probe_video', { projectId, relPath });
  } catch {
    return null;
  }
}

/** 動画の代表フレームを PNG で書き出し、その相対パスを返す（確認画面/一覧のサムネ用）。失敗時は null。 */
export async function extractVideoThumbnail(
  projectId: string,
  relPath: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>('extract_video_thumbnail', { projectId, relPath });
  } catch {
    return null;
  }
}
