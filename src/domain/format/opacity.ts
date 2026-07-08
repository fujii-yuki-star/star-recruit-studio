// 不透明度の単位変換を1箇所に集約する（#459 item5）。内部値は 0.0〜1.0、UI 表記は「濃さ(%)」0〜100 に統一。
// これで「0〜1 スライダー」と「濃さ(%) 0〜100」の2系統を一本化する（各画面での ×100 / ÷100 直書きをやめる）。

/** 内部の不透明度（0.0〜1.0）→ UI の「濃さ(%)」（0〜100・整数）。 */
export function opacityToPercent(ratio: number): number {
  return Math.round(clampRatio(ratio) * 100);
}

/** UI の「濃さ(%)」（0〜100）→ 内部の不透明度（0.0〜1.0）。範囲外は 0〜1 にクランプ。 */
export function percentToOpacity(percent: number): number {
  return clampRatio(percent / 100);
}

function clampRatio(v: number): number {
  if (Number.isNaN(v)) return 1;
  return Math.min(1, Math.max(0, v));
}
