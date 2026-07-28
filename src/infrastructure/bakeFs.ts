// 焼き出し（場面形式 → タイムライン形式・ADR-0032 決定13）で使うファイル操作（Tauri コマンド境界）。
// domain は「どのファイルを運ぶか」（`bakedFilePaths`）だけを決め、実体のコピーと容量の計測はここ（§4）。
// Tauri 非検出時（ブラウザでの開発）はファイルが存在しないので、容量 0・コピーなしで素通しする。
import { invoke } from '@tauri-apps/api/core';
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
): Promise<void> {
  if (!isTauri() || relPaths.length === 0) return;
  await invoke('copy_project_files', { srcProjectId, destProjectId, relPaths });
}
