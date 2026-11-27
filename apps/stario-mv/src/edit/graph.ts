// イージングのグラフ（MV-0015）の純粋な関数＝値・速さ・取っ手とキーの位置・動かしたあとの取引。
// ⚠️ 進み方の計算は描画の核（`mv-core` の `cubic_bezier_ease`）を写したもの＝同じ数で検査する（`graph.test.ts` と `eval.rs` の両方に同じ数）。
// ⚠️ ここでは**組み立てるだけ**。検査と保存は Rust の取引（`updateLayer` で値の `keyframes` を置き換える）。
import { animAt, nestPatch } from "./props";
import type { KeyPath } from "./keyframes";
import type { AnimValue, Keyframe, Layer, Op } from "./types";

/** 取っ手が書かれていないときの既定（直線と同じ＝`mv-core` の `DEFAULT_EASE_OUT`／`DEFAULT_EASE_IN`）。 */
export const DEFAULT_EASE_OUT: [number, number] = [1 / 3, 1 / 3];
export const DEFAULT_EASE_IN: [number, number] = [2 / 3, 2 / 3];
/** 影響の下限（0 にすると速さが求められない）。 */
export const MIN_INFLUENCE = 0.01;

/** CSS の cubic-bezier と同じ＝P0=(0,0)・P1・P2・P3=(1,1)。時間 t（0〜1）での進み具合（`mv-core` と同じ解き方）。 */
export function cubicBezierEase(p1: readonly number[], p2: readonly number[], t: number): number {
  const bez = (a: number, b: number, s: number): number => {
    const u = 1 - s;
    return 3 * u * u * s * a + 3 * u * s * s * b + s * s * s;
  };
  const dbez = (a: number, b: number, s: number): number => {
    const u = 1 - s;
    return 3 * u * u * a + 6 * u * s * (b - a) + 3 * s * s * (1 - b);
  };
  let s = t;
  for (let i = 0; i < 8; i++) {
    const x = bez(p1[0], p2[0], s) - t;
    const d = dbez(p1[0], p2[0], s);
    if (Math.abs(x) < 1e-9) return bez(p1[1], p2[1], s);
    if (Math.abs(d) < 1e-9) break;
    s -= x / d;
  }
  let lo = 0;
  let hi = 1;
  s = t;
  for (let i = 0; i < 60; i++) {
    const x = bez(p1[0], p2[0], s);
    if (Math.abs(x - t) < 1e-9) break;
    if (x < t) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return bez(p1[1], p2[1], s);
}

function comps(v: AnimValue): number[] {
  return Array.isArray(v) ? v : [v];
}

/** 区間（k0→k1）の、時間の割合 t（0〜1）での進み具合（止める＝0・直線＝t・曲線＝取っ手）。 */
export function progress(k0: Keyframe, k1: Keyframe, t: number): number {
  if (k0.interpolation === "hold") return 0;
  if (k0.interpolation === "linear") return t;
  return cubicBezierEase(easeOut(k0), easeIn(k1), t);
}

export function easeOut(k: Keyframe): [number, number] {
  return (k.easeOut as [number, number] | undefined) ?? DEFAULT_EASE_OUT;
}
export function easeIn(k: Keyframe): [number, number] {
  return (k.easeIn as [number, number] | undefined) ?? DEFAULT_EASE_IN;
}

/** その値の、フレーム（小数も可）での成分（最初より前は最初の値・最後より後は最後の値）。 */
export function valueAt(keys: readonly Keyframe[], frame: number): number[] {
  if (keys.length === 0) return [];
  if (frame <= keys[0].frame) return comps(keys[0].value);
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return comps(last.value);
  const i = keys.findIndex((k, j) => j + 1 < keys.length && frame >= k.frame && frame < keys[j + 1].frame);
  const [k0, k1] = [keys[i], keys[i + 1]];
  const p = progress(k0, k1, (frame - k0.frame) / (k1.frame - k0.frame));
  const a = comps(k0.value);
  const b = comps(k1.value);
  return a.map((x, c) => x + (b[c] - x) * p);
}

/** 区間の値の差の長さ（成分が2つなら長さ）。 */
function span(k0: Keyframe, k1: Keyframe): number {
  const a = comps(k0.value);
  const b = comps(k1.value);
  return Math.hypot(...a.map((x, c) => b[c] - x));
}

/** その値の、フレームでの速さ（1秒あたりの変わり方の大きさ）。キーの外・止めるは 0。 */
export function speedAt(keys: readonly Keyframe[], frame: number, fps: number): number {
  const i = keys.findIndex((k, j) => j + 1 < keys.length && frame >= k.frame && frame < keys[j + 1].frame);
  if (i < 0) return 0;
  const [k0, k1] = [keys[i], keys[i + 1]];
  if (k0.interpolation === "hold") return 0;
  const df = k1.frame - k0.frame;
  const avg = (span(k0, k1) * fps) / df;
  const t = (frame - k0.frame) / df;
  const h = 1e-4;
  const a = Math.max(0, t - h);
  const b = Math.min(1, t + h);
  return (avg * (progress(k0, k1, b) - progress(k0, k1, a))) / (b - a);
}

/** グラフの1つの点（フレーム・値）。 */
export interface GraphPoint {
  frame: number;
  value: number;
}

/** 曲線の区間の取っ手（区間の始まりのキーの番号 `i`・出か入りか・どの成分か〔速さなら -1〕・点）。 */
export interface GraphHandle {
  i: number;
  side: "out" | "in";
  comp: number;
  at: GraphPoint;
  /** 取っ手の根元（キーの点）。 */
  from: GraphPoint;
}

/** 値のグラフの取っ手（曲線の区間だけ・値の差が 0 の成分には出さない）。 */
export function valueHandles(keys: readonly Keyframe[]): GraphHandle[] {
  const out: GraphHandle[] = [];
  for (let i = 0; i + 1 < keys.length; i++) {
    const [k0, k1] = [keys[i], keys[i + 1]];
    if (k0.interpolation !== "bezier") continue;
    const df = k1.frame - k0.frame;
    const a = comps(k0.value);
    const b = comps(k1.value);
    const o = easeOut(k0);
    const n = easeIn(k1);
    a.forEach((v0, c) => {
      const dv = b[c] - v0;
      if (dv === 0) return;
      out.push({ i, side: "out", comp: c, from: { frame: k0.frame, value: v0 }, at: { frame: k0.frame + o[0] * df, value: v0 + o[1] * dv } });
      out.push({ i, side: "in", comp: c, from: { frame: k1.frame, value: b[c] }, at: { frame: k0.frame + n[0] * df, value: v0 + n[1] * dv } });
    });
  }
  return out;
}

/** 速さのグラフの取っ手（影響と速さ＝AE と同じ見せ方・曲線の区間だけ・値が変わらない区間には出さない）。 */
export function speedHandles(keys: readonly Keyframe[], fps: number): GraphHandle[] {
  const out: GraphHandle[] = [];
  for (let i = 0; i + 1 < keys.length; i++) {
    const [k0, k1] = [keys[i], keys[i + 1]];
    if (k0.interpolation !== "bezier") continue;
    const df = k1.frame - k0.frame;
    const avg = (span(k0, k1) * fps) / df;
    if (avg === 0) continue;
    const o = easeOut(k0);
    const n = easeIn(k1);
    const s0 = (o[1] / Math.max(o[0], MIN_INFLUENCE)) * avg;
    const s1 = ((1 - n[1]) / Math.max(1 - n[0], MIN_INFLUENCE)) * avg;
    out.push({ i, side: "out", comp: -1, from: { frame: k0.frame, value: s0 }, at: { frame: k0.frame + o[0] * df, value: s0 } });
    out.push({ i, side: "in", comp: -1, from: { frame: k1.frame, value: s1 }, at: { frame: k1.frame - (1 - n[0]) * df, value: s1 } });
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 値のグラフで取っ手を (frame, value) へ動かしたときの取っ手の値（時間の割合は 0〜1・値の割合は超えてよい）。 */
export function handleFromValue(keys: readonly Keyframe[], h: GraphHandle, to: GraphPoint): [number, number] {
  const [k0, k1] = [keys[h.i], keys[h.i + 1]];
  const df = k1.frame - k0.frame;
  const v0 = comps(k0.value)[h.comp];
  const dv = comps(k1.value)[h.comp] - v0;
  return [clamp((to.frame - k0.frame) / df, 0, 1), (to.value - v0) / dv];
}

/** 速さのグラフで取っ手を (frame, 速さ) へ動かしたときの取っ手の値（影響は 1〜100%・速さは負にしない）。 */
export function handleFromSpeed(keys: readonly Keyframe[], h: GraphHandle, to: GraphPoint, fps: number): [number, number] {
  const [k0, k1] = [keys[h.i], keys[h.i + 1]];
  const df = k1.frame - k0.frame;
  const avg = (span(k0, k1) * fps) / df;
  const speed = Math.max(0, to.value);
  if (h.side === "out") {
    const x = clamp((to.frame - k0.frame) / df, MIN_INFLUENCE, 1);
    return [x, (speed * x) / avg];
  }
  const u = clamp((k1.frame - to.frame) / df, MIN_INFLUENCE, 1);
  return [1 - u, 1 - (speed * u) / avg];
}

/** 取っ手を書き換える取引（出＝区間の始まりのキーの easeOut・入り＝次のキーの easeIn）。錠は null。 */
export function setHandleOp(l: Layer, path: KeyPath, h: Pick<GraphHandle, "i" | "side">, handle: [number, number]): Op | null {
  const keys = animAt(l, path)?.keyframes;
  if (l.locked || !keys) return null;
  const at = h.side === "out" ? h.i : h.i + 1;
  const keyframes = keys.map((k, j) => (j !== at ? k : h.side === "out" ? { ...k, easeOut: handle } : { ...k, easeIn: handle }));
  return { op: "updateLayer", layerId: l.id, patch: nestPatch(path, { keyframes }) };
}

/** キーの値（その成分）を変える取引。錠は null。 */
export function setKeyValueOp(l: Layer, path: KeyPath, i: number, comp: number, value: number): Op | null {
  const keys = animAt(l, path)?.keyframes;
  if (l.locked || !keys || !keys[i]) return null;
  const keyframes = keys.map((k, j) => {
    if (j !== i) return k;
    if (!Array.isArray(k.value)) return { ...k, value };
    const v = k.value.slice();
    v[comp] = value;
    return { ...k, value: v };
  });
  return { op: "updateLayer", layerId: l.id, patch: nestPatch(path, { keyframes }) };
}

/** 縦の範囲（点の最小・最大に少し余白・幅 0 なら上下に 1）。 */
export function valueRange(points: readonly number[]): [number, number] {
  const finite = points.filter(Number.isFinite);
  if (finite.length === 0) return [0, 1];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.1;
  return [lo - pad, hi + pad];
}
