// 焼き出し（場面形式 → タイムライン形式・ADR-0032 決定13）で使うファイル操作（Tauri コマンド境界）。
// domain は「どのファイルを運ぶか」（`bakedFilePaths`）だけを決め、実体のコピーと容量の計測はここ（§4）。
// Tauri 非検出時（ブラウザでの開発）はファイルが存在しないので、容量 0・コピーなしで素通しする。
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from './assetFs';

/**
 * 焼くと増えるディスク容量（バイト）。焼く前に利用者へ伝えるための目安（決定13）。
 * 見つからないファイルは 0 として数える＝1つ欠けても提示を止めない。
 */
export async function bakeSizeBytes(projectId: string, relPaths: readonly string[]): Promise<number> {
  if (!isTauri() || relPaths.length === 0) return 0;
  return invoke<number>('project_files_size', { projectId, relPaths });
}

/**
 * 素材・音声を焼き出し先のプロジェクトへコピーする（自己完結＝ADR-0024 (6)）。
 * 相対パスの構造はそのまま保つので、焼いた文書の `filePath`/`voicePath` を書き換える必要はない。
 * **元のプロジェクトには一切書き込まない**（片道＝決定16）。
 */
export async function copyBakedFiles(
  srcProjectId: string,
  destProjectId: string,
  relPaths: readonly string[],
  /**
   * この回のコピーの合図（#1021）。**中止はこの合図でだけ効く**（PR #1054 レビュー 🔴）＝
   * 1つの旗にすると**プロセス全体で共有**され、焼き出しの中止が**並行して走っている複製**を巻き込む。
   */
  copyId = `copy_${Date.now()}`,
): Promise<CopyResult> {
  if (!isTauri() || relPaths.length === 0) return { copied: 0, cancelled: false };
  return await invoke<CopyResult>('copy_project_files', { srcProjectId, destProjectId, relPaths, copyId });
}

/**
 * コピーの結果（#1021）。⚠️ **中止は失敗と分けて返す**＝呼び出し側が理由を出すか決められる。
 * ⚠️ **`Err` の文字列では見分けない**（PR #1054 レビュー 🟡）＝**同じ文字列を両側に持つ**ことになり
 *（§2-7 違反）、言い回しを変えたとたんに**失敗として扱われる**。Rust がこの形で返す。
 */
export interface CopyResult {
  /** 実際に運んだ件数（元に無いファイルは飛ばすので、渡した数より少ないことがある）。 */
  copied: number;
  /** 利用者が中止したか（運んだものは片づけ済み）。 */
  cancelled: boolean;
}

/**
 * コピーを中止する（#1021）。**運んだものは Rust 側が片づける**＝素材だけがあって
 * `project.json` が無い**見えないゴミ**を残さない。失敗しても中止操作は続けられるよう握りつぶす。
 * ⚠️ **止めるのは合図で指した回だけ**（別の回を巻き込まない）。
 */
export async function cancelProjectCopy(copyId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('cancel_project_copy', { copyId });
  } catch {
    /* 中止の要求が届かなくても、画面の操作は続けられる（届いていれば次のファイルの手前で止まる） */
  }
}

/** 進み具合の合図（#1021）。`step` は**運び終えた数**（1 から）、`total` は渡した数。 */
export interface CopyProgressEvent {
  step: number;
  total: number;
}

/**
 * コピーの進み具合を受け取る（#1021・書き出しの `listenExportProgress` と同じ流儀）。
 * 返り値を呼ぶと購読をやめる。Tauri 非検出時は何もしない関数を返す。
 */
export async function listenCopyProgress(cb: (e: CopyProgressEvent) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    return await listen<CopyProgressEvent>('copy_progress', (ev) => cb(ev.payload));
  } catch {
    return () => {};
  }
}
