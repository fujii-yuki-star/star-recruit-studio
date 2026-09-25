// 実 AI プロバイダの Tauri コマンド境界（鍵保管・生成）。
// 鍵は Rust（keyring）内のみで扱い、ここでは**値を渡すだけ（保存）／受け取らない（has は有無のみ）**（§13§7・§2-6）。
// 非Tauri（ブラウザ開発）では鍵 API は使えないため has は false を返す。
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** AI プロバイダ識別子（Rust の is_supported_provider と一致させる）。app/provider 双方はここを参照する。 */
export const GEMINI_PROVIDER = 'gemini';

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

/**
 * この端末の構成でAI生成が「外部送信」になるか（実 Gemini＝端末外へ送信あり／Mock＝送信なし）。
 * §2-6（外部送信は事前確認必須）のガードと、プロバイダ選択（store の generateVideoPlan）が共有する単一の判定。
 * Tauri かつ鍵ありのときだけ true。非Tauri・鍵未設定は Mock 経路＝送信なし。
 */
export function willSendExternally(provider: string = GEMINI_PROVIDER): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  return hasApiKey(provider);
}

/** 保存済みAPIキーを削除する。非Tauri（ブラウザ開発）では何もしない。 */
export function deleteApiKey(provider: string): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke('delete_api_key', { provider });
}

/** 混み合っていて待ち直していることの知らせ（Rust が出す）。 */
export interface AiBusyWait {
  /** 何回目の待ち直しか（1 から）。 */
  attempt: number;
  /** 待ち直す上限。 */
  total: number;
  /** 今回待つ長さ（ミリ秒）。 */
  wait_ms: number;
}

/**
 * 混み合っていて待ち直すことを受け取る（#1244）。
 *
 * ⚠️ **黙って待たない**＝相手が混んでいると最長で 30 秒ほど待つ。何も出さないと**固まったように見える**
 *（この画面はもともと「わからない区間は流れるバー」で見せているが、**待ちの理由までは伝わらない**）。
 */
export async function onAiBusyWait(handler: (e: AiBusyWait) => void): Promise<() => void> {
  // ⚠️ **Tauri の外では何もしない**＝知らせを出すのは Rust なので、ブラウザ開発や検査では相手がいない。
  //   そのまま `listen` を呼ぶと**投げっぱなしの失敗**になり、**無関係な検査まで巻き込む**
  //  （実際、この関数を足した回に `GeneratingScreen` を描く検査5本が道連れで赤くなった）。
  //   `troubleLogFs` と同じ形にして、呼ぶ側は「外しに行く手」だけ受け取れるようにする。
  if (!isTauri()) return () => {};
  return listen<AiBusyWait>('ai-busy-wait', (e) => handler(e.payload));
}
