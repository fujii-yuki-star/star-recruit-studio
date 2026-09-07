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
): Promise<CopyResult> {
  if (!isTauri() || relPaths.length === 0) return { copied: 0, cancelled: false };
  try {
    return { copied: await invoke<number>('copy_project_files', { srcProjectId, destProjectId, relPaths }), cancelled: false };
  } catch (e) {
    // ⚠️ **中止は失敗ではない**（#1021）＝止めたのは利用者なので、理由を出さずに「中止した」として返す。
    //   ⚠️ **見分けは内部の目印で**＝文言で見分けると、翻訳や言い回しを変えたとたんに**失敗として扱われる**。
    if (typeof e === 'string' && e === COPY_CANCELLED_MARK) return { copied: 0, cancelled: true };
    throw e;
  }
}

/** コピーの結果（#1021）。**中止は失敗と分けて返す**＝呼び出し側が理由を出すか決められる。 */
export interface CopyResult {
  /** 実際に運んだ件数（元に無いファイルは飛ばすので、渡した数より少ないことがある）。 */
  copied: number;
  /** 利用者が中止したか（運んだものは片づけ済み）。 */
  cancelled: boolean;
}

/**
 * コピーを中止する（#1021）。**運んだものは Rust 側が片づける**＝素材だけがあって
 * `project.json` が無い**見えないゴミ**を残さない。失敗しても中止操作は続けられるよう握りつぶす。
 */
export async function cancelProjectCopy(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('cancel_project_copy');
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

/** 中止したときに Rust が返す内部の目印（利用者には出さない）。`assets.rs` と同じ文字列。 */
const COPY_CANCELLED_MARK = 'project copy cancelled by user';
