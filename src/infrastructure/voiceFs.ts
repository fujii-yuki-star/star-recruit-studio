// ナレーション音声の取り込み/読み出し（Tauriコマンド境界）。domain は型のみ、I/Oはここに隔離（CLAUDE.md §4）。
// 音声(WAV)は <appData>/projects/<id>/voices/<sceneId>.wav に保管し、Narration.voicePath はプロジェクト相対（11 §7.4）。
// Tauri 非検出時（ブラウザ開発）は永続化せず null を返す（表示用 data URL はメモリ内で別途保持される）。
import { invoke } from '@tauri-apps/api/core';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** ナレーション音声(data URL)をプロジェクトに保存し、プロジェクト相対 voicePath を返す。Tauri 非検出時は null（非永続）。 */
export async function importVoiceFile(
  projectId: string,
  sceneId: string,
  dataUrl: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string>('import_voice', { projectId, sceneId, dataBase64: dataUrl });
}

/** プロジェクト相対パスの音声を data URL で読む（汎用ファイル読み出し read_asset_data_url を共用）。失敗・非Tauri時は null。 */
export async function readVoiceDataUrl(projectId: string, relPath: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>('read_asset_data_url', { projectId, relPath });
  } catch {
    return null;
  }
}
