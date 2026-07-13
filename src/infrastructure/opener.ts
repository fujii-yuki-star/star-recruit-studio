// 外部URL（クレジットのソース入手先など）を既定ブラウザで開く／保存したファイルの場所を開く（#404）。
// Tauri は opener プラグイン（capabilities: opener:default ＋ reveal-item-in-dir/open-path）、ブラウザ環境は window.open。
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 外部URLを開く。失敗は呼び出し側で扱えるよう reject する（クレジット用途では握りつぶし可）。 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** 保存したファイルの場所（フォルダ）を開き、そのファイルを選択表示する（書き出し完了の導線・#404）。
 *  非技術者が長いパス文字列を自力で辿らずに済む。Tauri 専用（書き出し完了は Tauri 環境のみ）。失敗は呼び出し側で扱う。 */
export async function revealSavedFile(path: string): Promise<void> {
  if (!isTauri()) return;
  await revealItemInDir(path);
}

/** 保存したファイルを既定アプリ（動画プレーヤー）で開く（#404）。Tauri 専用。失敗は呼び出し側で扱う。 */
export async function openSavedFile(path: string): Promise<void> {
  if (!isTauri()) return;
  await openPath(path);
}
