import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// ⚠️ **形は `domain` にある**（§4＝`domain` は他層に依存しない）。ここは運ぶだけ。
export type { StartupArgError, StartupRequest } from '../domain/startup/startupRequest';
import type { StartupRequest } from '../domain/startup/startupRequest';

/** 起動のときの頼まれごとを聞きに行く（**投げつけられるのを待たない**＝取りこぼさないため）。 */
export async function startupRequest(): Promise<StartupRequest> {
  return invoke<StartupRequest>('startup_request');
}

/** すでに動いているアプリへ引数が渡されたときに呼ばれる（ADR-0042 決定③）。 */
export async function onStartupRequestForwarded(
  handler: (req: StartupRequest) => void,
): Promise<() => void> {
  return listen<StartupRequest>('startup-request-forwarded', (e) => handler(e.payload));
}

/** 取り込む元の中身（`project.json` の文字列）を読む。⚠️ **検証は呼ぶ側**（正典はドメインにある）。 */
export async function readImportFolder(folder: string): Promise<string> {
  return invoke<string>('read_import_folder', { folder });
}

/** フォルダを取り込む。⚠️ **番号は呼ぶ側が決める**（採番の規則は `11.2`＝ドメイン）。 */
export async function importProjectFolder(
  folder: string,
  projectId: string,
): Promise<{ copied: number; skipped: number }> {
  return invoke<{ copied: number; skipped: number }>('import_project_folder', { folder, projectId });
}

/**
 * 頼まれごとが終わったことを伝える（**閉じるかどうかは Rust が決める**＝判断を2か所に置かない）。
 *
 * ⚠️ **`forwarded` をそのまま渡す**＝渡された仕事では閉じない（ADR-0042 決定③）。
 */
export async function finishStartupJob(ok: boolean, forwarded: boolean): Promise<void> {
  await invoke('finish_startup_job', { ok, forwarded });
}
