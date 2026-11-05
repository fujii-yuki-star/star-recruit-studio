// あなた向け会社説明の一時の動画の置き場所（β・ADR-0061 決定5・`11 §7.9`）の Tauri コマンド境界（§4）。
// 置き場所は `appData/temporary-sessions/<projectId>/`。中身は通常の動画と同じ形なので、作ったあとの保存・素材・声・書き出しは
// 通常の口がそのまま使える（Rust の `project_dir` が両方の置き場所を見る）。
import { invoke } from '@tauri-apps/api/core';
import { forgetTemporaryProject, markTemporaryProject } from './projectLocation';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** いま在る一時の動画の番号（採番で重ならないように使う）。アプリの外では空。 */
export async function listBriefingSessions(): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>('briefing_session_list');
}

/**
 * 一時の動画のフォルダを作り、一時の動画として覚える。⚠️ どちらかの置き場所に同じ番号があれば断る（Rust 側）。
 * アプリの外では覚えるだけ。
 */
export async function createBriefingSession(projectId: string): Promise<void> {
  if (isTauri()) await invoke('briefing_session_create', { projectId });
  markTemporaryProject(projectId);
}

/** 一時の動画を消す（「この回のデータを消す」）。⚠️ 消すのは一時の置き場所の中だけ（Rust 側）。 */
export async function deleteBriefingSession(projectId: string): Promise<void> {
  if (isTauri()) await invoke('briefing_session_delete', { projectId });
  forgetTemporaryProject(projectId);
}

/** 24 時間を過ぎた一時の動画を消す（この機能を開いた時・1 時間ごと）。消した数。アプリの外では 0。 */
export async function cleanupBriefingSessions(): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>('briefing_sessions_cleanup');
}

/** 名前を変えてコピーする1つ（`importScenes` の `files` と同じ形）。 */
export interface BriefingRenamedFile {
  fromProjectId: string;
  fromRelPath: string;
  toRelPath: string;
}

/**
 * 原本の動画から一時の動画へ、ファイルを名前を変えてコピーする。`missing`＝元に無かったファイル（新しい名前）。
 * ⚠️ コピー先は一時の動画だけ・原本には書かない・途中で失敗したらコピーした分を消す（Rust 側）。アプリの外では何もしない。
 */
export async function copyBriefingSessionFiles(destProjectId: string, files: readonly BriefingRenamedFile[]): Promise<{ copied: number; missing: string[] }> {
  if (!isTauri()) return { copied: 0, missing: [] };
  return invoke<{ copied: number; missing: string[] }>('briefing_session_copy_files', { destProjectId, files });
}
