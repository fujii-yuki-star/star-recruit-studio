// アプリの窓を全画面にする／戻す（#1262）。Tauri 境界＝app 層から窓の API を隔離する（§4）。
//
// ⚠️ **アプリの中とブラウザで入り口が違う**＝アプリの中は窓そのものを全画面にする（Tauri の
// `setFullscreen`・権限 `core:window:allow-set-fullscreen`）。ブラウザ（開発時）は文書の全画面 API。
// ⚠️ **失敗しても画面は壊さない**＝全画面にならないだけで、欄を広げる方は効いている（呼ぶ側はそのまま続ける）。
import { isTauri } from './assetFs';

/** 全画面にする（`on`）／戻す。できたら `true`。 */
export async function setAppFullscreen(on: boolean): Promise<boolean> {
  try {
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setFullscreen(on);
      return true;
    }
    if (typeof document === 'undefined') return false;
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    if (!on && document.fullscreenElement) await document.exitFullscreen?.();
    return true;
  } catch {
    return false;
  }
}
