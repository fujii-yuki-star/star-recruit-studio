// レイヤー＋キーフレームの画面（MV-0014）の純粋な関数＝開いた値の行・キーの選択・掴んで動かす・消す。
// ⚠️ ここでは**組み立てるだけ**。検査と保存は Rust の取引（`updateLayer` で値の `keyframes` を置き換える）。
// ⚠️ 錠のかかったレイヤーのキーは動かさない・消さない（AE の型＝錠は編集から守る）。
import { animAt, isAnimated, nestPatch, propDefsFor, type AnimPath } from "./props";
import type { Composition, Keyframe, Layer, Op } from "./types";

/** キーを持てる値の場所（変形・図形・タイムリマップ）。 */
export type KeyPath = AnimPath | "/timeRemap";

/** キー1つ（どのレイヤーの・どの値の・どのフレームか）。 */
export interface KeyRef {
  layerId: string;
  path: KeyPath;
  frame: number;
}

/** 開き方＝全部の値（▸）か、キーフレームのある値だけ（`U`）。 */
export type Reveal = "all" | "animated";

/** キーの名前（選択の Set に入れる文字列）。 */
export function keyId(k: KeyRef): string {
  return `${k.layerId}|${k.path}|${k.frame}`;
}

/** キーの名前 → キー（形が違えば null）。 */
export function parseKeyId(id: string): KeyRef | null {
  const [layerId, path, f] = id.split("|");
  const frame = Number(f);
  if (!layerId || !path || !Number.isInteger(frame)) return null;
  return { layerId, path: path as KeyPath, frame };
}

/** 値の名前（値の欄と同じ）。 */
export function pathLabel(l: Layer, path: KeyPath): string {
  if (path === "/timeRemap") return "タイムリマップ";
  return propDefsFor(l).find((d) => d.path === path)?.label ?? path;
}

/** 開いたときに並べる値の行（決定1）。`animated`＝キーフレームのある値だけ。 */
export function propRowsFor(l: Layer, reveal: Reveal): KeyPath[] {
  const paths: KeyPath[] = propDefsFor(l)
    .map((d) => d.path)
    .filter((p) => animAt(l, p) != null);
  if (l.timeRemap) paths.push("/timeRemap");
  return reveal === "all" ? paths : paths.filter((p) => isAnimated(animAt(l, p)));
}

/** そのレイヤーにキーフレームのある値が1つでもあるか（`U` で開くもの）。 */
export function hasAnimated(l: Layer): boolean {
  return propRowsFor(l, "animated").length > 0;
}

/** その値のキーの並び（無ければ空）。 */
export function keysAt(l: Layer, path: KeyPath): Keyframe[] {
  return animAt(l, path)?.keyframes ?? [];
}

/** 選択の中で、今もあるキーだけ（動かした・消したあとに古い名前を残さない）。 */
export function liveKeys(comp: Composition, ids: Iterable<string>): KeyRef[] {
  const out: KeyRef[] = [];
  for (const id of ids) {
    const k = parseKeyId(id);
    const l = k && comp.layers.find((x) => x.id === k.layerId);
    if (k && l && keysAt(l, k.path).some((x) => x.frame === k.frame)) out.push(k);
  }
  return out;
}

/** キーをレイヤーと値ごとにまとめる（錠のかかったレイヤーは除く）。 */
function groups(comp: Composition, keys: readonly KeyRef[]): { l: Layer; path: KeyPath; frames: Set<number> }[] {
  const out = new Map<string, { l: Layer; path: KeyPath; frames: Set<number> }>();
  for (const k of keys) {
    const l = comp.layers.find((x) => x.id === k.layerId);
    if (!l || l.locked) continue;
    const g = out.get(`${k.layerId}|${k.path}`) ?? { l, path: k.path, frames: new Set<number>() };
    g.frames.add(k.frame);
    out.set(`${k.layerId}|${k.path}`, g);
  }
  return [...out.values()];
}

/** 同じレイヤーへの差分を1つの取引の中の1つの操作にまとめる。 */
function toOps(patches: Map<string, Record<string, unknown>[]>): Op[] {
  return [...patches].map(([layerId, ps]) => ({ op: "updateLayer", layerId, patch: ps.reduce((a, p) => merge(a, p), {}) }));
}

function merge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] =
      cur && typeof cur === "object" && !Array.isArray(cur) && v && typeof v === "object" && !Array.isArray(v)
        ? merge(cur as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}

function push(patches: Map<string, Record<string, unknown>[]>, layerId: string, p: Record<string, unknown>): void {
  patches.set(layerId, [...(patches.get(layerId) ?? []), p]);
}

/**
 * 選んだキーをまとめて `delta` フレーム動かす（決定2）。動かした先に同じ値の別のキーがあれば、動かしたキーで置き換える（AE と同じ）。
 * 0 フレーム・何も動かないなら空。
 */
export function moveKeysOps(comp: Composition, keys: readonly KeyRef[], delta: number): Op[] {
  if (delta === 0) return [];
  const patches = new Map<string, Record<string, unknown>[]>();
  for (const { l, path, frames } of groups(comp, keys)) {
    const all = keysAt(l, path);
    const moved = all.filter((k) => frames.has(k.frame)).map((k) => ({ ...k, frame: k.frame + delta }));
    if (moved.length === 0) continue;
    const landing = new Set(moved.map((k) => k.frame));
    const kept = all.filter((k) => !frames.has(k.frame) && !landing.has(k.frame));
    const keyframes = [...kept, ...moved].sort((a, b) => a.frame - b.frame);
    push(patches, l.id, nestPatch(path, { keyframes }));
  }
  return toOps(patches);
}

/** 動かしたあとのキーの名前（選択を動かした先へ付け替える）。錠のかかったレイヤーのキーは動かないのでそのまま。 */
export function movedKeyIds(comp: Composition, keys: readonly KeyRef[], delta: number): string[] {
  return keys.map((k) => {
    const locked = comp.layers.find((x) => x.id === k.layerId)?.locked;
    return keyId(locked ? k : { ...k, frame: k.frame + delta });
  });
}

/**
 * 選んだキーを消す（決定2）。その値のキーが全部消えたら、最後に残っていた（時刻のいちばん後の）キーの値の固定値に戻す
 * （キーの無いキーフレームは形として置けない＝MV-0008 決定5 と同じ）。
 */
export function removeKeysOps(comp: Composition, keys: readonly KeyRef[]): Op[] {
  const patches = new Map<string, Record<string, unknown>[]>();
  for (const { l, path, frames } of groups(comp, keys)) {
    const all = keysAt(l, path);
    const rest = all.filter((k) => !frames.has(k.frame));
    if (rest.length === all.length) continue;
    push(
      patches,
      l.id,
      rest.length > 0
        ? nestPatch(path, { keyframes: rest })
        : nestPatch(path, { value: all[all.length - 1].value, keyframes: null }),
    );
  }
  return toOps(patches);
}

/** ▸＝開く（全部の値）・閉じる。 */
export function toggleReveal(revealed: ReadonlyMap<string, Reveal>, layerId: string): Map<string, Reveal> {
  const next = new Map(revealed);
  if (next.has(layerId)) next.delete(layerId);
  else next.set(layerId, "all");
  return next;
}

/**
 * `U`＝選んだレイヤーの、キーフレームのある値だけを開く（AE と同じ）。全部がもうそう開いていれば閉じる。
 * キーフレームの無いレイヤーは開かない。
 */
export function revealAnimated(
  revealed: ReadonlyMap<string, Reveal>,
  comp: Composition,
  selected: ReadonlySet<string>,
): Map<string, Reveal> {
  const targets = comp.layers.filter((l) => selected.has(l.id) && hasAnimated(l)).map((l) => l.id);
  const next = new Map(revealed);
  const allOpen = targets.length > 0 && targets.every((id) => revealed.get(id) === "animated");
  for (const id of targets) {
    if (allOpen) next.delete(id);
    else next.set(id, "animated");
  }
  return next;
}

/** 押した◆で選択を変える（`Ctrl`／`Shift`＝足す・外す・無し＝それだけ）。選ばれている◆を素で押したら変えない（まとめて掴める）。 */
export function clickKey(selected: ReadonlySet<string>, id: string, additive: boolean): string[] {
  if (additive) return selected.has(id) ? [...selected].filter((x) => x !== id) : [...selected, id];
  return selected.has(id) ? [...selected] : [id];
}
