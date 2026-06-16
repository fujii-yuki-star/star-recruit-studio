// 実 AI プロバイダの Tauri コマンド境界（鍵保管・生成）。
// 鍵は Rust（keyring）内のみで扱い、ここでは**値を渡すだけ（保存）／受け取らない（has は有無のみ）**（§13§7・§2-6）。
// 非Tauri（ブラウザ開発）では鍵 API は使えないため has は false を返す。
import { invoke } from '@tauri-apps/api/core';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** AI に生成を依頼し、応答テキスト（JSON 文字列）を得る。鍵は Rust が keyring から取得（JS は鍵を持たない）。 */
export function aiGenerate(
  provider: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  return invoke<string>('ai_generate', { provider, model, system, user });
}

/** APIキーを OS 資格情報ストアへ保存する。非Tauri（ブラウザ開発）では何もしない。 */
export function saveApiKey(provider: string, apiKey: string): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke('save_api_key', { provider, apiKey });
}

/** APIキーが保存済みかを返す（値は取得しない＝有無のみ）。非Tauri では false。 */
export function hasApiKey(provider: string): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  return invoke<boolean>('has_api_key', { provider });
}

/** 保存済みAPIキーを削除する。非Tauri（ブラウザ開発）では何もしない。 */
export function deleteApiKey(provider: string): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke('delete_api_key', { provider });
}
