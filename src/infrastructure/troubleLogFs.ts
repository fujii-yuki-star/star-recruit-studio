// うまくいかないときの記録（#396）の**置き場**を聞く（Tauriコマンド境界）。
//
// ⚠️ **中身は読まない**＝入っているのは実装の言葉（FFmpeg の出力など）で、画面には出せない（§2-3）。
// ここで扱うのは**場所だけ**＝開くかどうか・誰かへ送るかどうかは利用者が決める（§2-6＝アプリは送らない）。
import { invoke } from '@tauri-apps/api/core';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 記録の置き場。**`null` は「まだ無い／作れなかった」**（ブラウザ開発・書き込めない環境）。
 *
 * ⚠️ **`null` と「空文字」を混ぜない**＝呼ぶ側は `null` のとき導線そのものを出さない
 *（押せるのに何も起きない、を作らない＝§2-5）。
 */
export async function troubleLogDir(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return (await invoke<string | null>('trouble_log_dir')) ?? null;
  } catch {
    return null;
  }
}
