// 仕上がり確認を出す**別窓**（ADR-0050）。Tauri 境界＝app 層から窓と窓の間の連絡を隔離する（§4）。
//
// ⚠️ **窓どうしは JS の状態を共有しない**＝ここが運ぶのは「写し」（本体→別窓）と「命令」（別窓→本体）だけ。
// 何を写し、どの命令を受けるかは app 層（`timelineMirror`）が決める＝ここは形を運ぶだけ。
// ⚠️ **アプリの中とブラウザで入り口が違う**＝アプリの中は Tauri の窓とイベント、ブラウザ（開発時）は
// `window.open` と `BroadcastChannel`（同じ作りで画面を確かめられるようにする）。
import { isTauri } from './assetFs';
import type { WindowRect } from '../domain/layout/previewWindowRect';

/** 別窓の名前（権限 `capabilities/preview.json` の `windows` と同じ）。 */
export const PREVIEW_WINDOW_LABEL = 'preview';
/** 本体の窓の名前（Tauri の既定）。 */
const MAIN_WINDOW_LABEL = 'main';
/**
 * 別窓で開く印。⚠️ **検索文字列ではなく `#` で渡す**＝アプリの中の URL に `?` を付けると、
 * 読み込む先の解決で落ちることがある（`#` は読み込み先に関わらない）。
 */
const PREVIEW_WINDOW_HASH = '#preview-window';

const EVENT_TO_PREVIEW = 'stario://preview-mirror';
const EVENT_TO_MAIN = 'stario://preview-command';
const BROADCAST_NAME = 'stario-preview-window';

/** 本体→別窓。`values` は変わった項目、`cleared` は値が `undefined` になった項目（JSON で落ちるため別に送る）。 */
export type MainToPreviewMessage =
  | { type: 'patch'; values: Record<string, unknown>; cleared: string[] }
  | { type: 'close' };
/**
 * 別窓→本体。`ready`＝写しを全部ほしい／`call`＝store の操作をしてほしい／
 * `tick`＝再生中の描く合図（本体の窓が隠れて本体の合図が止まっても、本体の時計を進める）。
 */
export type PreviewToMainMessage =
  | { type: 'ready' }
  | { type: 'tick' }
  | { type: 'call'; name: string; args: unknown[] };

/** この画面が別窓として開かれたか。 */
export function isPreviewWindowContext(): boolean {
  return typeof window !== 'undefined' && window.location.hash === PREVIEW_WINDOW_HASH;
}

// ── ブラウザ（開発時）の代わりの道 ────────────────────────────────────────────
let browserWindow: Window | null = null;
/** 別窓が閉じたときに知らせる相手（本体で登録）。 */
const closedHandlers = new Set<() => void>();
const fireClosed = (): void => { for (const h of [...closedHandlers]) h(); };
let channel: BroadcastChannel | null = null;
const bc = (): BroadcastChannel | null => {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  channel = new BroadcastChannel(BROADCAST_NAME);
  return channel;
};

/** 画面の一覧と本体の位置（論理座標）。取れなければ空。 */
export async function readScreens(): Promise<{ monitors: WindowRect[]; main: WindowRect | null }> {
  try {
    if (isTauri()) {
      const { availableMonitors, getCurrentWindow } = await import('@tauri-apps/api/window');
      const list = await availableMonitors();
      const monitors = list.map((m) => {
        // ⚠️ **使える範囲**（タスクバーを除く）があればそちら＝窓の下端がタスクバーに潜らない。
        const area = m.workArea ?? { position: m.position, size: m.size };
        const s = m.scaleFactor || 1;
        return { x: area.position.x / s, y: area.position.y / s, w: area.size.width / s, h: area.size.height / s };
      });
      const win = getCurrentWindow();
      const [pos, size, s] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()]);
      return { monitors, main: { x: pos.x / s, y: pos.y / s, w: size.width / s, h: size.height / s } };
    }
    if (typeof window === 'undefined') return { monitors: [], main: null };
    const sc = window.screen as Screen & { availLeft?: number; availTop?: number };
    return {
      monitors: [{ x: sc.availLeft ?? 0, y: sc.availTop ?? 0, w: sc.availWidth, h: sc.availHeight }],
      main: { x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight },
    };
  } catch {
    return { monitors: [], main: null };
  }
}

/**
 * 別窓を開く。**もう開いていれば手前へ出すだけ**。開けたら `true`。
 * ⚠️ **隠して作ってから出さない**（ADR-0050 決定7・tauri #14643＝隠して作った窓は落とし込みを受けない）。
 * ⚠️ **本体を持ち主にする**（`parent`）＝本体を閉じれば別窓も閉じる（取り残された窓でアプリが終わらない、を作らない）。
 */
export async function openPreviewWindow(title: string, rect: WindowRect | null): Promise<boolean> {
  try {
    if (isTauri()) {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const existing = await WebviewWindow.getByLabel(PREVIEW_WINDOW_LABEL);
      if (existing) {
        await existing.setFocus();
        return true;
      }
      const win = new WebviewWindow(PREVIEW_WINDOW_LABEL, {
        url: `index.html${PREVIEW_WINDOW_HASH}`,
        title,
        parent: MAIN_WINDOW_LABEL,
        ...(rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.w), height: Math.round(rect.h) } : {}),
        minWidth: 480,
        minHeight: 320,
        focus: true,
      });
      // 消えたら知らせる＝×で閉じた・本体から閉じた、のどちらでも本体の印を戻す。
      void win.once('tauri://destroyed', fireClosed);
      return await new Promise<boolean>((resolve) => {
        void win.once('tauri://created', () => resolve(true));
        void win.once('tauri://error', () => resolve(false));
      });
    }
    if (typeof window === 'undefined') return false;
    if (browserWindow && !browserWindow.closed) {
      browserWindow.focus();
      return true;
    }
    const features = rect
      ? `popup,left=${Math.round(rect.x)},top=${Math.round(rect.y)},width=${Math.round(rect.w)},height=${Math.round(rect.h)}`
      : 'popup,width=1280,height=800';
    browserWindow = window.open(`${window.location.pathname}${PREVIEW_WINDOW_HASH}`, BROADCAST_NAME, features);
    return browserWindow != null;
  } catch {
    return false;
  }
}

/** 別窓を閉じる（本体から）。開いていなければ何もしない。 */
export async function closePreviewWindow(): Promise<void> {
  try {
    if (isTauri()) {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      await (await WebviewWindow.getByLabel(PREVIEW_WINDOW_LABEL))?.close();
      return;
    }
    if (browserWindow) {
      browserWindow.close();
      browserWindow = null;
      fireClosed(); // ブラウザは閉じた知らせが来ない（見に行く相手も今消した）＝ここで知らせる
    }
  } catch {
    // 閉じられなくても本体は続ける（別窓の×で閉じられる）。
  }
}

/** 別窓が閉じたら知らせる（本体で使う）。購読を解く関数を返す。 */
export function onPreviewWindowClosed(handler: () => void): () => void {
  closedHandlers.add(handler);
  // ⚠️ **アプリの中は窓の「消えた」知らせ**（開いたときに登録）。ブラウザは知らせが無い＝見に行く。
  const t = !isTauri() && typeof window !== 'undefined'
    ? window.setInterval(() => {
      if (browserWindow && browserWindow.closed) {
        browserWindow = null;
        fireClosed();
      }
    }, 500)
    : null;
  return () => {
    closedHandlers.delete(handler);
    if (t != null) window.clearInterval(t);
  };
}

/** 本体→別窓へ送る。 */
export async function sendToPreview(msg: MainToPreviewMessage): Promise<void> {
  try {
    if (isTauri()) {
      const { emitTo } = await import('@tauri-apps/api/event');
      await emitTo(PREVIEW_WINDOW_LABEL, EVENT_TO_PREVIEW, msg);
      return;
    }
    bc()?.postMessage({ to: 'preview', msg });
  } catch {
    // 別窓が居ない・閉じかけ＝送れなくても本体は続ける。
  }
}

/** 別窓→本体へ送る。 */
export async function sendToMain(msg: PreviewToMainMessage): Promise<void> {
  try {
    if (isTauri()) {
      const { emitTo } = await import('@tauri-apps/api/event');
      await emitTo(MAIN_WINDOW_LABEL, EVENT_TO_MAIN, msg);
      return;
    }
    bc()?.postMessage({ to: 'main', msg });
  } catch {
    // 本体が居ない＝別窓は写しが止まるだけ。
  }
}

type Tagged = { to: 'main' | 'preview'; msg: unknown };

async function listenOn<T>(event: string, to: Tagged['to'], handler: (msg: T) => void): Promise<() => void> {
  try {
    if (isTauri()) {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      return await getCurrentWebviewWindow().listen<T>(event, (e) => handler(e.payload));
    }
    const ch = bc();
    if (!ch) return () => {};
    const on = (e: MessageEvent<Tagged>): void => {
      if (e.data && e.data.to === to) handler(e.data.msg as T);
    };
    ch.addEventListener('message', on);
    return () => ch.removeEventListener('message', on);
  } catch {
    return () => {};
  }
}

/** 本体で、別窓からの知らせを受ける。 */
export function onPreviewMessage(handler: (msg: PreviewToMainMessage) => void): Promise<() => void> {
  return listenOn(EVENT_TO_MAIN, 'main', handler);
}

/** 別窓で、本体からの知らせを受ける。 */
export function onMainMessage(handler: (msg: MainToPreviewMessage) => void): Promise<() => void> {
  return listenOn(EVENT_TO_PREVIEW, 'preview', handler);
}

/** 別窓が自分を閉じる。 */
export async function closeSelf(): Promise<void> {
  try {
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
      return;
    }
    window.close();
  } catch {
    // 閉じられなければ×で閉じてもらう。
  }
}

/**
 * 別窓の位置と大きさが変わったら知らせる（別窓で使う・論理座標）。次に開くときの置き場所に使う。
 */
export async function onOwnRectChange(handler: (rect: WindowRect) => void): Promise<() => void> {
  try {
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const report = async (): Promise<void> => {
        // ⚠️ **全画面の間は覚えない**＝次に開くと画面いっぱいの枠のない窓になる。
        if (await win.isFullscreen()) return;
        const [pos, size, s] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()]);
        handler({ x: pos.x / s, y: pos.y / s, w: size.width / s, h: size.height / s });
      };
      const a = await win.onMoved(() => void report().catch(() => {}));
      const b = await win.onResized(() => void report().catch(() => {}));
      return () => { a(); b(); };
    }
    if (typeof window === 'undefined') return () => {};
    const on = (): void => handler({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  } catch {
    return () => {};
  }
}
