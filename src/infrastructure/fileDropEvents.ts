// ファイルを**窓へ落としたとき**の受け口（Tauri 境界・#1026 ②）。app 層から Tauri 依存を隔離する（§4）。
//
// ⚠️ **アプリの中とブラウザで入り口が違う**＝ブラウザは要素の `drop` で `File` が来るが、アプリの中は
// 窓ごと Tauri が受けて**絶対パス**が来る（要素には届かない）。素材のバイトを JS に載せない流儀
// （ADR-0004）はそのままで、どの枠の上に落ちたかは**座標**で見る（`isPointInRect`）。
//
// ⚠️ **既定の遷移は起きない**＝`dragDropEnabled`（既定 true）のとき WebView 側の落とし込みは
// Tauri が横取りするので、「落としたらファイルが開いてしまう」は起きない（受け口を足すだけでよい）。
import { isTauri } from './assetFs';

export interface FileDropEvent {
  /** 落とした（`drop`）／枠の上を通っている（`over`）／出ていった（`leave`）。 */
  kind: 'drop' | 'over' | 'leave';
  /** 落とされた絶対パス（`drop` のときだけ中身がある）。 */
  paths: string[];
  /** 窓の中の**物理**座標（`leave` では無い）。CSS の点へ直すのは `cssPointOf`。 */
  position: { x: number; y: number } | null;
}

/**
 * 窓へのファイル落としを購読する。**アプリの中でないときは何もしない**（購読を解く関数だけ返す）。
 *
 * ⚠️ **取り込みは購読側が決める**＝ここは Tauri の形をアプリの言葉へ直すだけ（どの枠が受けるか・
 * 何を通すかは持たない）。
 */
export async function onWindowFileDrop(handler: (e: FileDropEvent) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    return await subscribe(handler);
  } catch {
    // ⚠️ **受け口が作れなくても画面は壊さない**＝落として取り込めないだけで、選ぶ導線は生きている
    // （ここで投げると、この枠を持つ画面がまるごと出なくなる）。
    return () => {};
  }
}

async function subscribe(handler: (e: FileDropEvent) => void): Promise<() => void> {
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  const un = await getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === 'drop') handler({ kind: 'drop', paths: [...p.paths], position: p.position });
    else if (p.type === 'over') handler({ kind: 'over', paths: [], position: p.position });
    else if (p.type === 'leave') handler({ kind: 'leave', paths: [], position: null });
    // 上以外（将来 Tauri が種類を増やしたとき）は**何もしない**＝知らない出来事で取り込みを始めない。
  });
  return un;
}
