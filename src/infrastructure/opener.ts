// 外部URL（クレジットのソース入手先など）を既定ブラウザで開く／保存したファイルの場所を開く（#404）。
// Tauri は opener プラグイン（capabilities: opener:default ＋ reveal-item-in-dir/open-path）、ブラウザ環境は window.open。
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";

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

/**
 * 保存したファイルを既定アプリ（動画プレーヤー）で開く（#404）。Tauri 専用。失敗は呼び出し側で扱う。
 *
 * ⚠️ **プラグインの `openPath` を直に呼ばない**（#1118）＝あれは画面から**任意の場所**を渡せる入口で、
 * 許可の範囲（scope）を書かないと**必ず弾かれる**（実際そうなっていて、設定の「記録の場所を開く」も
 * 書き出し完了の「動画を再生」も**必ず断られて**いた）。
 * ⚠️ **範囲を書き足す道は採らない**＝書き出した動画は利用者が保存先を選ぶので範囲で表せない。
 * Rust 側に入口を1つ作り、**アプリが自分で作った場所**だけを開く（`open_produced_path`）。
 */
export async function openSavedFile(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_produced_path", { path });
}
