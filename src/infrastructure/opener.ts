// 外部URL（クレジットのソース入手先など）を既定ブラウザで開く。
// Tauri は opener プラグイン（capabilities: opener:default）、ブラウザ環境は window.open。
import { openUrl } from "@tauri-apps/plugin-opener";

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
