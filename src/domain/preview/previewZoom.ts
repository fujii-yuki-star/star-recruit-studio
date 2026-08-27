// 仕上がり確認のズーム（#142）。**倍率の決め方だけ**を持つ純粋な部分（§7 テスト対象）。
//
// ⚠️ **共有部品として作る**（利用者条件 2026-08-17・`CLAUDE.md §11`）＝場面編集専用に作ると
// ADR-0032 の凍結（場面形式の編集機能の拡張）とぶつかる。`ScenePreview` を使う画面
//（場面編集・見た目パターン編集・仕上がり確認）すべてに同時に効かせる。

/** 段階の倍率（%）。フィットは別扱い（領域に合わせるので固定値ではない）。 */
export const PREVIEW_ZOOM_STEPS = [50, 75, 100, 150, 200] as const;

/** ズームの状態。`"fit"`＝領域に合わせる（既定）。数値＝その%で見る。 */
export type PreviewZoom = 'fit' | number;

export const PREVIEW_ZOOM_MIN = PREVIEW_ZOOM_STEPS[0];
export const PREVIEW_ZOOM_MAX = PREVIEW_ZOOM_STEPS[PREVIEW_ZOOM_STEPS.length - 1];

/**
 * いま何%で見えているか。
 *
 * ⚠️ **フィットは 100% とは限らない**＝領域が狭ければ縮み、広ければ伸びる。画面に出す数字は
 * **実際の見え方**でないと「100% なのに小さい」になる（§2-5 の裏＝表示が事実と違う）。
 */
export function zoomPercentOf(zoom: PreviewZoom, fitPercent: number): number {
  return zoom === 'fit' ? Math.round(fitPercent) : zoom;
}

/**
 * 拡大／縮小を1段動かす。
 *
 * ⚠️ **フィットからの1段は「いまの見え方」から数える**＝`fit` が 63% のときに「拡大」を押したら
 * **75%**（63 より大きい最初の段）へ行く。100% へ飛ばすと**縮んで見える**ことがある。
 * ⚠️ 端では**動かさない**（同じ値を返す）＝呼び出し側が「変わらない操作」を履歴や再描画に流さない。
 */
export function stepZoom(zoom: PreviewZoom, dir: 'in' | 'out', fitPercent: number): PreviewZoom {
  const current = zoomPercentOf(zoom, fitPercent);
  const steps = PREVIEW_ZOOM_STEPS;
  if (dir === 'in') {
    const next = steps.find((s) => s > current);
    return next ?? (current >= PREVIEW_ZOOM_MAX ? zoom : PREVIEW_ZOOM_MAX);
  }
  const prev = [...steps].reverse().find((s) => s < current);
  return prev ?? (current <= PREVIEW_ZOOM_MIN ? zoom : PREVIEW_ZOOM_MIN);
}

/** その向きへまだ動かせるか（押せない理由を出すために使う＝押せるのに何も起きない、を作らない）。 */
export function canStepZoom(zoom: PreviewZoom, dir: 'in' | 'out', fitPercent: number): boolean {
  return stepZoom(zoom, dir, fitPercent) !== zoom;
}

/**
 * 表示する箱の実寸（px）。
 *
 * ⚠️ **CSS の `transform: scale` ではなく実寸を変える**＝操作オーバーレイ（`FreeLayoutOverlay`）は
 * `getBoundingClientRect()` から縮尺を導く（`scale = rect.width / canvas.width`）ので、
 * **箱が実際に大きくなれば座標整合は自動で取れる**。`transform` だと rect は変わるが
 * レイアウトが追従せず、**掴んだ場所と実際の位置がずれる**（#142 のメモにある「座標整合に注意」）。
 */
export function zoomedBox(
  fitBox: { width: number; height: number },
  zoom: PreviewZoom,
  fitPercent: number,
): { width: number; height: number } {
  if (zoom === 'fit') return fitBox;
  const ratio = zoom / fitPercent;
  return { width: fitBox.width * ratio, height: fitBox.height * ratio };
}

/**
 * フィット時が実寸の何%か（`canvas` の幅に対する表示幅）。
 *
 * 0 以下（計測前）は 100 として扱う＝**計測前に段が飛ばない**（`stepZoom` が変な段を選ばない）。
 */
export function fitPercentOf(fitWidth: number, canvasWidth: number): number {
  if (fitWidth <= 0 || canvasWidth <= 0) return 100;
  return (fitWidth / canvasWidth) * 100;
}
