// project.json の保存/読込（Tauriコマンド境界）。domain は型と純粋ロジックのみ、I/Oはここに隔離（CLAUDE.md §4）。
// Tauri 非検出時（ブラウザでの開発・プレビュー）は localStorage にフォールバックし、開発フローを止めない。
import type { RestorePoint } from '../domain/project/restorePoints';
import { invoke } from '@tauri-apps/api/core';

export interface ProjectSummary {
  projectId: string;
  projectName: string;
  updatedAt: string;
  /**
   * 文書形式（ADR-0032・11 §1）。**タイムライン形式のときだけ `'timeline'`**（場面形式は書かないので未設定）。
   * 一覧が開く先を選ぶのに使う＝開いてから「形式が違う」と断らずに済む。判定は `resolveProjectFormat` を通す。
   */
  format?: string;
}

const LS_PREFIX = 'project:';
const LAST_PROJECT_KEY = 'lastProjectId';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 最後に保存/読込したプロジェクトID（次回起動時の自動復元用）。localStorage は Tauri WebView でも永続する。 */
export function getLastProjectId(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_PROJECT_KEY) : null;
}

export function setLastProjectId(projectId: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_PROJECT_KEY, projectId);
}

/** 次回起動時の自動復元対象を消す（削除したプロジェクトを開こうとしないため＝#212）。 */
export function clearLastProjectId(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LAST_PROJECT_KEY);
}

/** プロジェクトをディスクから完全に削除する（フォルダごと・#212）。 */
export async function deleteProjectDoc(projectId: string): Promise<void> {
  if (isTauri()) {
    await invoke('delete_project', { projectId });
    return;
  }
  localStorage.removeItem(LS_PREFIX + projectId);
}

/** project.json を保存し、保存先（パス or キー）を返す。 */
export async function saveProjectDoc(projectId: string, projectJson: string): Promise<string> {
  if (isTauri()) return invoke<string>('save_project', { projectJson });
  localStorage.setItem(LS_PREFIX + projectId, projectJson);
  return `${LS_PREFIX}${projectId}`;
}

/** project.json の本文を返す。 */
export async function loadProjectDoc(projectId: string): Promise<string> {
  if (isTauri()) return invoke<string>('load_project', { projectId });
  const text = localStorage.getItem(LS_PREFIX + projectId);
  if (text === null) throw new Error('保存されたプロジェクトが見つかりません。');
  return text;
}

/** 保存済みプロジェクトの要約一覧（更新日時の新しい順）。 */
export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  if (isTauri()) return invoke<ProjectSummary[]>('list_projects');
  const out: ProjectSummary[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key === null || !key.startsWith(LS_PREFIX)) continue;
    const text = localStorage.getItem(key);
    if (text === null) continue;
    try {
      const v = JSON.parse(text) as Partial<ProjectSummary>;
      out.push({
        projectId: v.projectId ?? key.slice(LS_PREFIX.length),
        projectName: v.projectName ?? '',
        updatedAt: v.updatedAt ?? '',
        ...(typeof v.format === 'string' ? { format: v.format } : {}),
      });
    } catch {
      // 壊れたエントリは一覧から除外する
    }
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/**
 * 一覧に出す小さな絵を保存する（#397）。`projects/<id>/preview.png`。
 * ⚠️ **失敗しても保存そのものは止めない**（呼ぶ側が投げっぱなしにする）＝絵が無くても一覧は開ける。
 */
export async function saveProjectThumbnail(projectId: string, dataUrl: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('save_project_thumbnail', { projectId, dataUrl });
}

/**
 * 前に保存できていたところが**いつのものか**（無ければ `null`・#263）。
 *
 * ⚠️ **いつのものかを返す**＝どれだけ巻き戻るかが分からないと、戻すかどうかを決められない。
 * 非 Tauri は `null`（控えの仕組みはアプリ側にある）。
 */
export async function projectBackupTime(projectId: string): Promise<Date | null> {
  if (!isTauri()) return null;
  const secs = await invoke<number | null>('project_backup_time', { projectId });
  return secs == null ? null : new Date(secs * 1000);
}

/**
 * 前に保存できていたところへ戻す（利用者の明示操作・#263）。
 *
 * ⚠️ **黙って戻さない**（§2-5）＝開けなかったときに、利用者が選んで押したときだけ通る。
 * 開けなかったほうも消さずに残る（`project.broken.json`）。
 */
export async function restoreProjectBackup(projectId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('restore_project_backup', { projectId });
}

/**
 * 復元ポイントの一覧（#263 段階2）。非 Tauri は空。
 *
 * ⚠️ **時刻は名前に入っている**＝ファイルの更新時刻から採らない（コピーや同期で変わる）。
 */
export async function listRestorePoints(projectId: string): Promise<RestorePoint[]> {
  if (!isTauri()) return [];
  const rows = await invoke<[string, number][]>('list_restore_points', { projectId });
  return rows.map(([name, savedAt]) => ({ name, savedAt }));
}

/** いまの内容を復元ポイントとして控える（作るかどうかは呼び出し側が決める）。 */
export async function takeRestorePoint(projectId: string, atMs: number): Promise<void> {
  if (!isTauri()) return;
  await invoke('take_restore_point', { projectId, atMs });
}

/** 古い復元ポイントを消す（残す数は呼び出し側が決める）。 */
export async function dropRestorePoint(projectId: string, name: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('drop_restore_point', { projectId, name });
}

/** 復元ポイントの中身（戻す前に、いまの内容と見比べるため）。 */
export async function readRestorePoint(projectId: string, name: string): Promise<string> {
  if (!isTauri()) return '';
  return await invoke<string>('read_restore_point', { projectId, name });
}

/**
 * 戻した内容を書き込む（利用者の明示操作・#263 段階2）。
 *
 * ⚠️ **戻す前の状態も復元ポイントとして残る**＝「戻したけど、やっぱり戻す前がよかった」に戻れる。
 * ⚠️ **時計はここで読む**＝呼ぶのは画面（描画中の `Date.now()` は再描画のたびに違う値になりうる）。
 */
export async function restoreProjectText(projectId: string, text: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('restore_project_text', { projectId, text, nowMs: Date.now() });
}
