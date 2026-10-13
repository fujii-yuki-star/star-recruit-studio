// 動きの支点の選び先（ADR-0059 決定1）。画面は「9か所から選ぶ」＝上下左右・四隅・中心（After Effects のアンカーポイントの
// 置き場の型）。値は**箱に対する割合**（0〜1）。名前は画面の文言（`uiLabels`）が持つ。
/**
 * 支点の**既定＝中心**（`TimelineClip.pivot` 未指定のとき・ADR-0059 決定1）。
 * ⚠️ 描画の核（`applyInterpolatedTransform`）・ゆがみ（`clipWarpOf`）・動きの道筋（`motionPathOf`）・編集（`setClipPivot`）が
 *   **同じ既定を読む**＝1か所だけ変わると、道筋と描画が割れる（0.5.2 出口監査）。
 */
export const CLIP_PIVOT_DEFAULT = { x: 0.5, y: 0.5 } as const;

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
  const x = pivot?.x ?? CLIP_PIVOT_DEFAULT.x;
  const y = pivot?.y ?? CLIP_PIVOT_DEFAULT.y;
  return CLIP_PIVOT_PRESETS.find((p) => p.x === x && p.y === y)?.id ?? null;
}

/**
 * 支点の**キャンバス上の点**（箱の中心 `center`・大きさ `w`×`h`・向き `rotDeg` の箱で、支点を**箱の向きで測る**）。
 * 動きの道筋とゆがみの行列が同じこの1つを使う（PR #1427 の監査 ℹ️＝同じ式が2か所に書き写されていた）。
 */
export function pivotPointOf(
  center: { x: number; y: number },
  pivot: { x: number; y: number } | undefined,
  w: number,
  h: number,
  rotDeg: number,
): { x: number; y: number } {
  // 中心からのずれ（箱の向きの座標）＝割合から中心の割合（0.5）を引いて大きさを掛ける。
  const ox = ((pivot?.x ?? CLIP_PIVOT_DEFAULT.x) - 0.5) * w;
  const oy = ((pivot?.y ?? CLIP_PIVOT_DEFAULT.y) - 0.5) * h;
  const r = (rotDeg * Math.PI) / 180;
  return { x: center.x + ox * Math.cos(r) - oy * Math.sin(r), y: center.y + ox * Math.sin(r) + oy * Math.cos(r) };
}
