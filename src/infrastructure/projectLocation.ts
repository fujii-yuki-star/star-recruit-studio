// 動画のフォルダが、通常の置き場所（`projects/`）か一時の置き場所（`temporary-sessions/`）か（ADR-0061 決定5・`11 §7.9`）。
//
// Rust の口はどれも `project_dir`（通常の動画が先・無ければ一時の動画）で決めるので、番号だけ渡せば足りる。
// ⚠️ **画面が自分で道を組む所だけ**（asset:// の URL）がこれを見る＝一時の動画を作った・開いた番号を覚えておく。
// 覚えるのは起動している間だけ（一時の動画は起動をまたいで開かない＝閉じたら学生の画面を抜ける・ADR-0061 判断）。

/** 通常の置き場所の名前（`appData` の直下）。 */
export const PROJECTS_DIR_NAME = 'projects';
/** 一時の置き場所の名前（Rust の `temp_sessions::SESSIONS_DIR_NAME` と同じ）。 */
export const TEMPORARY_SESSIONS_DIR_NAME = 'temporary-sessions';

const temporaryIds = new Set<string>();

/** 一時の動画として覚える（作ったとき）。 */
export function markTemporaryProject(projectId: string): void {
  temporaryIds.add(projectId);
}

/** 覚えを外す（消したとき）。 */
export function forgetTemporaryProject(projectId: string): void {
  temporaryIds.delete(projectId);
}

/** その動画のフォルダが入っている置き場所の名前。 */
export function projectStorageDirName(projectId: string): string {
  return temporaryIds.has(projectId) ? TEMPORARY_SESSIONS_DIR_NAME : PROJECTS_DIR_NAME;
}
