// タイムラインの時刻と位置・吸着の計算（MV-0008 決定4）。画面に依存しない純粋な関数。
import type { Composition, Layer } from "./types";

/** 吸い付く距離（画素・MV-0008 決定4＝8 画素以内）。 */
export const SNAP_PX = 8;
/** 拡大の範囲（1 フレームあたりの画素）。 */
export const MIN_PX_PER_FRAME = 0.05;
export const MAX_PX_PER_FRAME = 60;

export function frameToX(frame: number, pxPerFrame: number): number {
  return frame * pxPerFrame;
}

/** 位置 → いちばん近いフレーム。 */
export function xToFrame(x: number, pxPerFrame: number): number {
  return Math.round(x / pxPerFrame);
}

/** 拡大・縮小（`Alt＋ホイール`）。上へ回す（deltaY<0）と拡大。範囲の外へは出さない。 */
export function zoomed(pxPerFrame: number, deltaY: number): number {
  const k = deltaY < 0 ? 1.25 : 1 / 1.25;
  return Math.min(MAX_PX_PER_FRAME, Math.max(MIN_PX_PER_FRAME, pxPerFrame * k));
}

/** 欄の幅にコンポジション全体が収まる拡大率。 */
export function fitPxPerFrame(width: number, durationFrames: number): number {
  if (durationFrames <= 0 || width <= 0) return 1;
  return Math.min(MAX_PX_PER_FRAME, Math.max(MIN_PX_PER_FRAME, width / durationFrames));
}

/**
 * 吸い付く先（MV-0008 決定4）＝今の時刻・コンポジションの始まりと終わり・ほかのレイヤーの始まりと終わり・マーカー。
 * `exclude`＝動かしているレイヤー（自分の端には吸い付かない）。
 */
export function snapTargets(comp: Composition, playhead: number, exclude: ReadonlySet<string>): number[] {
  const t = new Set<number>([playhead, 0, comp.durationFrames]);
  for (const l of comp.layers) {
    if (exclude.has(l.id)) continue;
    t.add(l.inFrame);
    t.add(l.outFrame);
  }
  for (const m of comp.markers) t.add(m.frame);
  return [...t];
}

/**
 * 吸着＝動かしている端（複数可）のうち、吸い付く先にいちばん近いものを合わせる量（フレーム）。
 * 8 画素より遠ければ 0。⚠️ いちばん近い1つだけに合わせる（複数を同時に満たそうとしない＝MV-0008 未解決の論点の始め方）。
 */
export function snapOffset(
  edges: readonly number[],
  targets: readonly number[],
  pxPerFrame: number,
  thresholdPx: number = SNAP_PX,
): number {
  let best = 0;
  let bestDist = Infinity;
  for (const e of edges) {
    for (const t of targets) {
      const d = Math.abs(t - e) * pxPerFrame;
      if (d <= thresholdPx && d < bestDist) {
        bestDist = d;
        best = t - e;
      }
    }
  }
  return best;
}

/** レイヤーの長さ（フレーム）。 */
export function lengthOf(l: Pick<Layer, "inFrame" | "outFrame">): number {
  return l.outFrame - l.inFrame;
}
