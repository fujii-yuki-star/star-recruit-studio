// アプリの窓を全画面にする／戻す（#1262）。Tauri 境界＝app 層から窓の API を隔離する（§4）。
//
// ⚠️ **アプリの中とブラウザで入り口が違う**＝アプリの中は窓そのものを全画面にする（Tauri の
// `setFullscreen`・権限 `core:window:allow-set-fullscreen`）。ブラウザ（開発時）は文書の全画面 API。
// ⚠️ **失敗しても画面は壊さない**＝全画面にならないだけで、欄を広げる方は効いている（呼ぶ側はそのまま続ける）。
import { isTauri } from './assetFs';

/**
 * いちばん最後に頼まれた値（#1269 レビュー 🟡）＝続けて押されたとき、非同期の完了が入れ替わって
 * **古い頼みが最後に効く**のを防ぐ（最後の頼みと違う結果で終わったら、もう一度だけ最後の頼みを掛け直す）。
 */
let wanted: boolean | null = null;

async function apply(on: boolean): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setFullscreen(on);
    return;
  }
  if (typeof document === 'undefined') return;
  if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  if (!on && document.fullscreenElement) await document.exitFullscreen?.();
}

/** 全画面にする（`on`）／戻す。できたら `true`。 */
export async function setAppFullscreen(on: boolean): Promise<boolean> {
  wanted = on;
  try {
    await apply(on);
    if (wanted !== on) await apply(wanted);
    return true;
  } catch {
    return false;
  }
}

/**
 * **窓の全画面が外から変わったら知らせる**（#1269 レビュー 🟡）＝ブラウザの Esc・OS の操作で全画面が
 * 外れたとき、画面の「大きく見る」の状態を戻すために使う。購読を解く関数を返す。
 * ⚠️ 知らせられない環境では何もしない（解く関数だけ返す）。
 */
export async function onAppFullscreenChange(handler: (on: boolean) => void): Promise<() => void> {
  try {
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      // 全画面の出入りは窓の大きさの変化として来る＝そのたびに今の状態を聞く。
      return await win.onResized(() => {
        void win.isFullscreen().then(handler).catch(() => {});
      });
    }
    if (typeof document === 'undefined') return () => {};
    const on = (): void => handler(document.fullscreenElement != null);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  } catch {
    return () => {};
  }
}
