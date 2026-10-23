// 焼いた canvas を PNG のバイトにする（書き出しの高速化・2026-10-23）。
//
// ⚠️ **PNG にするのは別スレッド**（`pngEncodeWorker`）＝主スレッドは絵の写し（`createImageBitmap`）を渡すだけで、
//   次のコマを描きに戻れる。⚠️ `HTMLCanvasElement.toBlob` は使わない＝画面が空くまで PNG 化を後回しにするので、
//   実測で主スレッドが8割待ちになり遅くなった。
// ⚠️ 別スレッドが使えない環境（古い WebView・検査）では、今までどおり `toDataURL` から作る＝結果は同じ PNG の画素。

/** しばらく使わなければ別スレッドを終える（覚えた字体と同じ考え＝書き出しの後に残さない）。 */
export const PNG_WORKER_IDLE_MS = 60_000;

/**
 * 別スレッドの数（2026-10-23）＝**1つ**。⚠️ 増やしても速くならなかった（講座の動画を同じ時間帯に交互に書き出して
 * 1つ 404・410 秒／2つ 405・418 秒）＝ノート PC では、同時に回すスレッドが増えると主スレッドの速さが落ち、
 * 描く側（主スレッド）が律速のまま。PNG 化は重ねて運ぶ（`STAGING_IN_FLIGHT`）ので1つで追いつく。
 */
export const PNG_WORKER_COUNT = 1;

const workers: Worker[] = [];
let turn = 0;
let nextId = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();

const ENCODE_FAILED = '動画の絵を作れませんでした。パソコンを再起動してから、もう一度お試しください。';

function canUseWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
}

function nextWorker(): Worker {
  if (workers.length < PNG_WORKER_COUNT) workers.push(startWorker());
  turn = (turn + 1) % workers.length;
  return workers[turn]!;
}

function startWorker(): Worker {
  const w = new Worker(new URL('./pngEncodeWorker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; buf?: ArrayBuffer; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.buf) p.resolve(new Uint8Array(e.data.buf));
    else p.reject(new Error(ENCODE_FAILED));
  };
  w.onerror = () => {
    // 別スレッドが落ちたら、待っている全部を失敗にする（黙って待ち続けない）。次は作り直す。
    for (const p of pending.values()) p.reject(new Error(ENCODE_FAILED));
    pending.clear();
    w.terminate();
    const i = workers.indexOf(w);
    if (i >= 0) workers.splice(i, 1);
  };
  return w;
}

function scheduleIdleStop(): void {
  if (idleTimer != null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (pending.size > 0) return scheduleIdleStop();
    for (const w of workers) w.terminate();
    workers.length = 0;
  }, PNG_WORKER_IDLE_MS);
}

/**
 * canvas の絵を PNG のバイトにする。**絵を写した時点で返る**（`bytes` は後で揃う）＝その間に呼ぶ側は次を描ける。
 * ⚠️ canvas は返った後に使い回してよい（写しを渡してある）。
 */
export async function encodePngLater(canvas: HTMLCanvasElement): Promise<{ bytes: Promise<Uint8Array> }> {
  if (!canUseWorker()) {
    const dataUrl = canvas.toDataURL('image/png');
    return { bytes: Promise.resolve(dataUrlToBytes(dataUrl)) };
  }
  const bitmap = await createImageBitmap(canvas);
  const w = nextWorker();
  scheduleIdleStop();
  const id = (nextId += 1);
  const bytes = new Promise<Uint8Array>((resolve, reject) => pending.set(id, { resolve, reject }));
  w.postMessage({ id, bitmap }, [bitmap]);
  return { bytes };
}

/** data URL（base64）をバイトへ戻す（別スレッドが使えないときの受け皿）。 */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
