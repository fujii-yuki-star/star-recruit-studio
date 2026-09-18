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
 *
 * ⚠️ **断ったときは理由の文も渡す**（#1212）＝渡さないと、頼んだ側（外の AI）が受け取れるのは
 * **数字だけ**になる。断る理由は複数あり、**どれも直し方が違う**のに、返るのは同じ `1` だった。
 * `18_EXTERNAL_AGENT_CONTRACT.md` は断りの文を**契約として**書いているのに、実行時には
 * **画面にしか出ていなかった**＝資料を読んでいる相手にしか効かない契約になっていた。
 * ⚠️ **画面に出すのと同じ文を渡す**＝2か所に別の文を持たない（§6）。
 */
export async function finishStartupJob(
  ok: boolean,
  forwarded: boolean,
  message?: string | null,
): Promise<void> {
  await invoke('finish_startup_job', { ok, forwarded, message: message ?? null });
}
