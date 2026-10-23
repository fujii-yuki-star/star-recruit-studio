// 書き出しのコマを描く**隠した窓**（ADR-0070）。Tauri 境界＝窓の作成と、窓どうしの知らせだけを隔離する（§4）。
//
// ⚠️ **窓どうしは JS の状態を共有しない**＝ここが運ぶのは「何を描くか」（本体→窓）と「描けたか」（窓→本体）だけ。
//   中身の意味（どの範囲を・どの文書で）は app 層（`app/renderWindow`）が決める。
// ⚠️ **アプリの中だけ**＝ブラウザ（開発時）には窓が無いので、本体1つで描く（`canOpenRenderWindows` が false）。
import { isTauri } from './assetFs';

/** 描く窓の名前の頭（権限 `capabilities/render.json` の `windows` と同じ）。 */
export const RENDER_WINDOW_LABEL_PREFIX = 'render-';
/** 本体の窓の名前（Tauri の既定）。 */
const MAIN_WINDOW_LABEL = 'main';
/** 描く窓で開く印（別窓と同じく `#` で渡す＝読み込む先の解決に関わらない）。 */
const RENDER_WINDOW_HASH = '#render-window';

const EVENT_TO_RENDER = 'stario://render-job';
const EVENT_TO_MAIN = 'stario://render-report';

/**
 * 窓どうしで送る・記録に残す**理由の文字列**（ADR-0070）。⚠️ **画面には出さない**＝窓が落ちた理由は本体が受けて
 * その範囲を描き直すだけで、利用者へは何も言わない（書き出しは続く）。記録（console.info）と窓どうしの知らせにだけ使う。
 */
export function reasonForLog(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

/** この画面が描く窓として開かれたか。 */
export function isRenderWindowContext(): boolean {
  return typeof window !== 'undefined' && window.location.hash === RENDER_WINDOW_HASH;
}

/** 描く窓を開けるか（アプリの中だけ）。 */
export function canOpenRenderWindows(): boolean {
  return isTauri();
}

/** いま空いている物理メモリ（バイト）。調べられなければ `null`（＝窓を足さない）。 */
export async function availableMemoryBytes(): Promise<number | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<number | null>('available_memory_bytes')) ?? null;
  } catch {
    return null;
  }
}

/**
 * 描く窓を**隠して**開く。開けたら `true`。
 * ⚠️ **本体を持ち主にする**（`parent`）＝本体を閉じれば一緒に閉じる（取り残された窓でアプリが終わらない、を作らない）。
 * ⚠️ **隠す**＝利用者には見せない（試作で、隠しても遅くならず画素も同じだった・ADR-0070 決定6）。
 */
export async function openRenderWindow(label: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const win = new WebviewWindow(label, {
      url: `index.html${RENDER_WINDOW_HASH}`,
      title: 'render',
      parent: MAIN_WINDOW_LABEL,
      visible: false,
      skipTaskbar: true,
      focus: false,
      width: 640,
      height: 360,
    });
    return await new Promise<boolean>((resolve) => {
      void win.once('tauri://created', () => resolve(true));
      void win.once('tauri://error', () => resolve(false));
    });
  } catch {
    return false;
  }
}

/** 描く窓を閉じる（無ければ何もしない）。 */
export async function closeRenderWindow(label: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const w = await WebviewWindow.getByLabel(label);
    await w?.close(); // ⚠️ `destroy` は本体の権限に無い（`close` は在る＝別窓と同じ）
  } catch {
    // 閉じられなくても本体は続ける（本体を閉じれば一緒に閉じる）。
  }
}

/** 本体→描く窓へ送る。 */
export async function sendToRenderWindow(label: string, msg: unknown): Promise<void> {
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo(label, EVENT_TO_RENDER, msg);
}

/** 描く窓→本体へ送る。 */
export async function sendToMainFromRender(msg: unknown): Promise<void> {
  try {
    const { emitTo } = await import('@tauri-apps/api/event');
    await emitTo(MAIN_WINDOW_LABEL, EVENT_TO_MAIN, msg);
  } catch {
    // 本体が居ない＝本体は時間切れで、この窓のぶんを自分で描く。
  }
}

async function listenHere<T>(event: string, handler: (msg: T) => void): Promise<() => void> {
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    return await getCurrentWebviewWindow().listen<T>(event, (e) => handler(e.payload));
  } catch {
    return () => {};
  }
}

/** 本体で、描く窓からの知らせを受ける。 */
export function onRenderReport<T>(handler: (msg: T) => void): Promise<() => void> {
  return listenHere(EVENT_TO_MAIN, handler);
}

/** 描く窓で、本体からの知らせを受ける。 */
export function onRenderJob<T>(handler: (msg: T) => void): Promise<() => void> {
  return listenHere(EVENT_TO_RENDER, handler);
}

/** この窓の名前（描く窓が自分を名乗るため）。 */
export async function currentWindowLabel(): Promise<string> {
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  return getCurrentWebviewWindow().label;
}
