// 値の欄とキーフレームを打つ（MV-0008 決定5・AE の型）。画面に依存しない純粋な関数。
// ⚠️ 値を「求める」のは Rust（描画の核と同じ計算＝`edit_eval`）。ここは**書く取引を組み立てる**だけ。
// ⚠️ キーフレームの frame はコンポジションのフレーム（schema の `Frame`）＝レイヤーをずらすときは一緒にずらす（`shiftKeyframesPatch`）。
import type { Animatable, AnimValue, Keyframe, Layer, UpdateOp } from "./types";

/** 動かせる値の場所。⚠️ Rust の `edit::ANIM_PATHS` と同じ並び（検査で突き合わせる）。 */
export const ANIM_PATHS = [
  "/transform/anchor",
  "/transform/position",
  "/transform/scale",
  "/transform/rotation",
  "/transform/opacity",
  "/shape/size",
  "/shape/cornerRadius",
] as const;
export type AnimPath = (typeof ANIM_PATHS)[number];

/** 値の欄の1行（並び・名前・成分の数・画面に出すときの倍率）。 */
export interface PropDef {
  path: AnimPath;
  label: string;
  /** 成分の数（1＝数・2＝[x, y]）。 */
  dims: 1 | 2;
  /** 画面の数＝値×倍率（大きさ・不透明度は %）。 */
  factor: number;
  unit: string;
  /** 掴んで動かすときの 1 画素あたりの量（画面の数で）。 */
  step: number;
}

const TRANSFORM_DEFS: PropDef[] = [
  { path: "/transform/anchor", label: "アンカー", dims: 2, factor: 1, unit: "", step: 1 },
  { path: "/transform/position", label: "位置", dims: 2, factor: 1, unit: "", step: 1 },
  { path: "/transform/scale", label: "大きさ", dims: 2, factor: 100, unit: "%", step: 1 },
  { path: "/transform/rotation", label: "回転", dims: 1, factor: 1, unit: "°", step: 1 },
  { path: "/transform/opacity", label: "不透明度", dims: 1, factor: 100, unit: "%", step: 1 },
];
const SHAPE_DEFS: PropDef[] = [
  { path: "/shape/size", label: "大きさ（図形）", dims: 2, factor: 1, unit: "", step: 1 },
  { path: "/shape/cornerRadius", label: "角の丸み", dims: 1, factor: 1, unit: "", step: 1 },
];

/** そのレイヤーに出す動かせる値の行。 */
export function propDefsFor(l: Layer): PropDef[] {
  return l.type === "shape" && (l.shape?.kind === "rectangle" || l.shape?.kind === "ellipse")
    ? [...TRANSFORM_DEFS, ...(l.shape.kind === "rectangle" ? SHAPE_DEFS : SHAPE_DEFS.slice(0, 1))]
    : TRANSFORM_DEFS;
}

/** 不透明度は 0〜1 の外へ出さない（掴んで動かしても行き過ぎない）。 */
export function clampFor(path: AnimPath, v: number[]): number[] {
  if (path === "/transform/opacity") return v.map((x) => Math.min(1, Math.max(0, x)));
  if (path === "/shape/cornerRadius") return v.map((x) => Math.max(0, x));
  return v;
}

function keysOf(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** レイヤーの中の、その場所の動かせる値。 */
export function animAt(l: Layer, path: AnimPath | "/timeRemap"): Animatable | undefined {
  let cur: unknown = l;
  for (const k of keysOf(path)) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur && typeof cur === "object" ? (cur as Animatable) : undefined;
}

/** `{ transform: { position: x } }` の形の差分（JSON Merge Patch）を作る。 */
export function nestPatch(path: string, leaf: unknown): Record<string, unknown> {
  return keysOf(path)
    .reverse()
    .reduce<unknown>((acc, k) => ({ [k]: acc }), leaf) as Record<string, unknown>;
}

function update(l: Layer, path: AnimPath, anim: Record<string, unknown>): UpdateOp {
  return { op: "updateLayer", layerId: l.id, patch: nestPatch(path, anim) };
}

/** 値を数の並びにする（数なら 1 つ）。 */
export function toComponents(v: AnimValue | undefined, dims: number): number[] {
  if (v == null) return new Array<number>(dims).fill(0);
  return Array.isArray(v) ? v.slice(0, dims) : [v];
}

/** 数の並びを値に戻す（1 成分なら数）。 */
export function fromComponents(c: number[], dims: number): AnimValue {
  return dims === 1 ? c[0] : c.slice(0, dims);
}

export function isAnimated(a: Animatable | undefined): boolean {
  return !!a && Array.isArray(a.keyframes) && a.keyframes.length > 0;
}

export function hasExpression(a: Animatable | undefined): boolean {
  return !!a && a.expression != null;
}

/** キーを入れる（同じフレームにあれば置き換え＝補間はそのキーのまま・無ければ直線＝AE の既定）。時刻の順に並べる。 */
export function upsertKey(keys: readonly Keyframe[], frame: number, value: AnimValue): Keyframe[] {
  const at = keys.findIndex((k) => k.frame === frame);
  if (at >= 0) return keys.map((k, i) => (i === at ? { ...k, value } : k));
  return [...keys, { frame, value, interpolation: "linear" as const }].sort((a, b) => a.frame - b.frame);
}

/**
 * 値を変える（MV-0008 決定5）。キーフレームになっていれば今の時刻にキーを打つ（あれば置き換える）、
 * なっていなければ固定値を変える。
 */
export function setValueOp(l: Layer, path: AnimPath, frame: number, value: AnimValue): UpdateOp {
  const a = animAt(l, path);
  if (isAnimated(a)) return update(l, path, { keyframes: upsertKey(a!.keyframes!, frame, value) });
  return update(l, path, { value });
}

/**
 * ストップウォッチ（AE の型）。固定値 → 今の時刻に今の値のキーを1つ打つ。
 * キーフレーム → 今の時刻の値の固定値に戻す（キーは消える）。
 */
export function toggleStopwatchOp(l: Layer, path: AnimPath, frame: number, current: AnimValue): UpdateOp {
  return isAnimated(animAt(l, path))
    ? update(l, path, { value: current, keyframes: null })
    : update(l, path, { value: null, keyframes: [{ frame, value: current, interpolation: "linear" }] });
}

/**
 * ◆＝今の時刻のキーを足す・消す。最後の1つを消すと、その値の固定値に戻す（キーの無いキーフレームは形として置けない）。
 */
export function toggleKeyOp(l: Layer, path: AnimPath, frame: number, current: AnimValue): UpdateOp | null {
  const a = animAt(l, path);
  if (!isAnimated(a)) return null;
  const keys = a!.keyframes!;
  const at = keys.findIndex((k) => k.frame === frame);
  if (at < 0) return update(l, path, { keyframes: upsertKey(keys, frame, current) });
  const rest = keys.filter((_, i) => i !== at);
  return rest.length > 0
    ? update(l, path, { keyframes: rest })
    : update(l, path, { value: keys[at].value, keyframes: null });
}

/** 前のキー（今の時刻より前でいちばん近い）。無ければ null。 */
export function prevKeyFrame(a: Animatable | undefined, frame: number): number | null {
  const fs = (a?.keyframes ?? []).map((k) => k.frame).filter((f) => f < frame);
  return fs.length > 0 ? Math.max(...fs) : null;
}

/** 次のキー（今の時刻より後でいちばん近い）。無ければ null。 */
export function nextKeyFrame(a: Animatable | undefined, frame: number): number | null {
  const fs = (a?.keyframes ?? []).map((k) => k.frame).filter((f) => f > frame);
  return fs.length > 0 ? Math.min(...fs) : null;
}

export function hasKeyAt(a: Animatable | undefined, frame: number): boolean {
  return (a?.keyframes ?? []).some((k) => k.frame === frame);
}

/** レイヤーのキーのあるフレーム（全部の動かせる値・重ねない・時刻の順）＝タイムラインの帯の下の◆。 */
export function keyFramesOf(l: Layer): number[] {
  const s = new Set<number>();
  for (const p of ANIM_PATHS) for (const k of animAt(l, p)?.keyframes ?? []) s.add(k.frame);
  return [...s].sort((a, b) => a - b);
}

/**
 * レイヤーをずらすとき、キーも同じだけずらす差分（AE の型＝キーはレイヤーと一緒に動く）。
 * ⚠️ キーの frame はコンポジションのフレームなので、ずらさないと動きだけ元の時刻に残る。
 */
export function shiftKeyframesPatch(l: Layer, delta: number): Record<string, unknown> {
  let patch: Record<string, unknown> = {};
  if (delta === 0) return patch;
  // タイムリマップのキーも一緒に（MV-0012＝ずらしても同じ時刻に同じ素材の秒を見せる・AE と同じ）
  for (const p of [...ANIM_PATHS, "/timeRemap" as const]) {
    const a = animAt(l, p);
    if (!isAnimated(a)) continue;
    const keyframes = a!.keyframes!.map((k) => ({ ...k, frame: k.frame + delta }));
    patch = deepMerge(patch, nestPatch(p, { keyframes }));
  }
  return patch;
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] =
      cur && typeof cur === "object" && !Array.isArray(cur) && v && typeof v === "object" && !Array.isArray(v)
        ? deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}

/** 動かせない値（描画モード・文字・単色・図形の塗り）を直す差分。`path` は `/text/fontSize` の形。 */
export function setPlainOp(l: Layer, path: string, value: unknown): UpdateOp {
  return { op: "updateLayer", layerId: l.id, patch: nestPatch(path, value) };
}

/** 色 [0〜1]×4 → `#rrggbb`（不透明度は別に持つ）。 */
export function colorToHex(c: readonly number[]): string {
  return `#${c
    .slice(0, 3)
    .map((x) =>
      Math.round(Math.min(1, Math.max(0, x)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** `#rrggbb` → 色（不透明度は元のまま）。読めなければ null。 */
export function hexToColor(hex: string, alpha: number): [number, number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const ch = (s: string): number => Math.round((parseInt(s, 16) / 255) * 10000) / 10000;
  return [ch(m[1]), ch(m[2]), ch(m[3]), alpha];
}
