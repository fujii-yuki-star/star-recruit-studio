// アプリ本体の静的メタデータ（バージョン等）取得。app 層から直接 @tauri-apps/api を触らず infrastructure に隔離する（§4）。
// バージョンの正典は tauri.conf.json（ビルド時埋め込み）＝About のためだけの二重管理をなくす（#413）。
import { getVersion } from "@tauri-apps/api/app";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** アプリのバージョン文字列を返す。非 Tauri（dev ブラウザ/テスト）や取得失敗時は空文字を返す
 *  ＝About のバージョン欄は補助表示のため空でも支障なし（About 本体・必須クレジットは常時描画・§13）。 */
export async function getAppVersion(): Promise<string> {
  if (!isTauri()) return "";
  try {
    return await getVersion();
  } catch {
    return "";
  }
}
