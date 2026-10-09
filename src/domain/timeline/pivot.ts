// 動きの支点の選び先（ADR-0059 決定1）。画面は「9か所から選ぶ」＝上下左右・四隅・中心（After Effects のアンカーポイントの
// 置き場の型）。値は**箱に対する割合**（0〜1）。名前は画面の文言（`uiLabels`）が持つ。
export const CLIP_PIVOT_PRESETS = [
  { id: 'center', x: 0.5, y: 0.5 },
  { id: 'bottom', x: 0.5, y: 1 },
  { id: 'top', x: 0.5, y: 0 },
  { id: 'left', x: 0, y: 0.5 },
  { id: 'right', x: 1, y: 0.5 },
  { id: 'topLeft', x: 0, y: 0 },
  { id: 'topRight', x: 1, y: 0 },
  { id: 'bottomLeft', x: 0, y: 1 },
  { id: 'bottomRight', x: 1, y: 1 },
] as const;

export type ClipPivotPresetId = (typeof CLIP_PIVOT_PRESETS)[number]['id'];

/** いまの支点がどの選び先か（どれにも当たらなければ `null`＝外の AI などが書いた半端な値）。未指定＝中心。 */
export function pivotPresetOf(pivot: { x: number; y: number } | undefined): ClipPivotPresetId | null {
  const x = pivot?.x ?? 0.5;
  const y = pivot?.y ?? 0.5;
  return CLIP_PIVOT_PRESETS.find((p) => p.x === x && p.y === y)?.id ?? null;
}
