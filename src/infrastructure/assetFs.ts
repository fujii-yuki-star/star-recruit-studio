// 素材ファイルの取り込み/読み出し（Tauriコマンド境界）。domain は型のみ、I/Oはここに隔離（CLAUDE.md §4）。
// Tauri 非検出時（ブラウザ開発）は永続化せず null を返す（表示用 data URL はメモリ内で別途保持される）。
import { invoke } from '@tauri-apps/api/core';

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

/** プロジェクト相対パスの素材を data URL で読む。Tauri 非検出 or 失敗（未配置のサンプル等）時は null。 */
export async function readAssetDataUrl(projectId: string, relPath: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>('read_asset_data_url', { projectId, relPath });
  } catch {
    return null;
  }
}
