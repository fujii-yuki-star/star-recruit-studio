// FREE 自由配置：ドラッグ中に「他の要素の辺・中心」へ吸着させる計算（スナップ強化／吸着ガイド・#205 後半）。
// 純粋ロジック（§7 テスト対象）。UI（FreeLayoutOverlay）はこの結果で位置を補正しガイド線を描く。
// 基準は他要素の left/right/centerX（縦ガイド）・top/bottom/centerY（横ガイド）。グリッド吸着とは独立。

/** 画面 px のスナップ許容距離。canvas 座標へは表示縮尺で割って換算する（縮尺に依らず指の感覚を一定に）。 */
export const SNAP_THRESHOLD_PX = 6;

/** 要素の辺・中心の座標（吸着先/吸着元の候補）。 */
export interface SnapEdges {
  left: number;
  right: number;
  centerX: number;
  top: number;
  bottom: number;
  centerY: number;
}

interface RectLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 矩形から辺・中心の座標を取り出す。 */
export function edgesOf(rect: RectLike): SnapEdges {
  return {
    left: rect.x,
    right: rect.x + rect.w,
    centerX: rect.x + rect.w / 2,
    top: rect.y,
    bottom: rect.y + rect.h,
    centerY: rect.y + rect.h / 2,
  };
}

export interface SnapResult {
  /** 吸着後の位置（吸着しなければ入力の x,y のまま）。 */
  x: number;
  y: number;
  /** 縦ガイドを引く canvas X（吸着していなければ null）。 */
  guideX: number | null;
  /** 横ガイドを引く canvas Y（吸着していなければ null）。 */
  guideY: number | null;
}

interface Candidate {
  from: number;
  to: (target: number) => number;
}

// 候補（rect 側の辺/中心）を targets（他要素の辺/中心）に最も近いものへ吸着。threshold 以内で最小距離を採用。
function bestSnap(candidates: Candidate[], targets: number[], threshold: number): { snapped: number | null; guide: number | null } {
  let bestDist = threshold;
  let snapped: number | null = null;
  let guide: number | null = null;
  for (const c of candidates) {
    for (const t of targets) {
      const d = Math.abs(c.from - t);
      if (d <= bestDist) {
        bestDist = d;
        snapped = c.to(t);
        guide = t;
      }
    }
  }
  return { snapped, guide };
}

/**
 * rect を others（他要素の辺・中心）へ吸着させた位置とガイド線を返す。
 * X/Y は独立に判定（縦ガイド＝X 一致／横ガイド＝Y 一致）。threshold は canvas px。座標は整数に丸める。
 */
export function snapToTargets(rect: RectLike, others: SnapEdges[], threshold: number): SnapResult {
  if (others.length === 0) return { x: rect.x, y: rect.y, guideX: null, guideY: null };
  const e = edgesOf(rect);
  const xCandidates: Candidate[] = [
    { from: e.left, to: (t) => t },
    { from: e.right, to: (t) => t - rect.w },
    { from: e.centerX, to: (t) => t - rect.w / 2 },
  ];
  const yCandidates: Candidate[] = [
    { from: e.top, to: (t) => t },
    { from: e.bottom, to: (t) => t - rect.h },
    { from: e.centerY, to: (t) => t - rect.h / 2 },
  ];
  const xTargets = others.flatMap((o) => [o.left, o.right, o.centerX]);
  const yTargets = others.flatMap((o) => [o.top, o.bottom, o.centerY]);
  const xr = bestSnap(xCandidates, xTargets, threshold);
  const yr = bestSnap(yCandidates, yTargets, threshold);
  return {
    x: xr.snapped != null ? Math.round(xr.snapped) : rect.x,
    y: yr.snapped != null ? Math.round(yr.snapped) : rect.y,
    guideX: xr.guide,
    guideY: yr.guide,
  };
}
