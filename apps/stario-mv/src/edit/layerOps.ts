// タイムラインの操作 → 取引の中身（MV-0008 決定4 の表）。画面に依存しない純粋な関数。
// ⚠️ ここでは**組み立てるだけ**。検査と保存は Rust の取引（外部 AI と同じ道＝決定1）。
// ⚠️ 錠のかかったレイヤーは動かさない・消さない（AE の型＝錠は編集から守る）。
import { shiftKeyframesPatch } from "./props";
import type { Composition, Layer, Op } from "./types";

/**
 * ずらす＝見えている範囲と素材の時刻を同じだけ（中身は動かない）。
 * キーフレームも同じだけずらす（AE の型＝キーの frame はコンポジションのフレームなので、ずらさないと動きだけ残る）。
 */
export function shiftPatch(l: Layer, delta: number): Record<string, unknown> {
  return {
    inFrame: l.inFrame + delta,
    outFrame: l.outFrame + delta,
    startFrame: l.startFrame + delta,
    ...shiftKeyframesPatch(l, delta),
  };
}

function editable(comp: Composition, ids: ReadonlySet<string>): Layer[] {
  return comp.layers.filter((l) => ids.has(l.id) && !l.locked);
}

/** 帯を掴んで左右へ（選んでいるものをまとめて同じだけ）。 */
export function moveOps(comp: Composition, ids: ReadonlySet<string>, delta: number): Op[] {
  if (delta === 0) return [];
  return editable(comp, ids).map((l) => ({ op: "updateLayer", layerId: l.id, patch: shiftPatch(l, delta) }));
}

/** 左の端を `frame` へ（範囲が空になるなら何もしない）。 */
export function trimInOps(comp: Composition, ids: ReadonlySet<string>, frame: number): Op[] {
  return editable(comp, ids)
    .filter((l) => frame < l.outFrame && frame !== l.inFrame)
    .map((l) => ({ op: "updateLayer", layerId: l.id, patch: { inFrame: frame } }));
}

/** 右の端を `frame`（含まない）へ。 */
export function trimOutOps(comp: Composition, ids: ReadonlySet<string>, frame: number): Op[] {
  return editable(comp, ids)
    .filter((l) => frame > l.inFrame && frame !== l.outFrame)
    .map((l) => ({ op: "updateLayer", layerId: l.id, patch: { outFrame: frame } }));
}

/**
 * 今の時刻で切る（`Alt+[`・`Alt+]`）。⚠️ AE の型＝`Alt+]` は今の時刻のコマを**最後に見えるコマ**にする
 *（終わりは含まないので `playhead + 1`）。
 */
export function trimToPlayheadOps(
  comp: Composition,
  ids: ReadonlySet<string>,
  playhead: number,
  edge: "in" | "out",
): Op[] {
  return edge === "in" ? trimInOps(comp, ids, playhead) : trimOutOps(comp, ids, playhead + 1);
}

/** 始まり／終わりを今の時刻へ動かす（`[`・`]`＝長さは変えずにずらす）。`]` は今の時刻が最後に見えるコマ。 */
export function moveToPlayheadOps(
  comp: Composition,
  ids: ReadonlySet<string>,
  playhead: number,
  edge: "in" | "out",
): Op[] {
  return editable(comp, ids)
    .map((l) => ({ l, delta: edge === "in" ? playhead - l.inFrame : playhead + 1 - l.outFrame }))
    .filter(({ delta }) => delta !== 0)
    .map(({ l, delta }) => ({ op: "updateLayer", layerId: l.id, patch: shiftPatch(l, delta) }));
}

/** 今の時刻で2つに分ける（`Ctrl+Shift+D`）。今の時刻が範囲の内側のレイヤーだけ。 */
export function splitOps(comp: Composition, ids: ReadonlySet<string>, playhead: number): Op[] {
  return editable(comp, ids)
    .filter((l) => l.inFrame < playhead && playhead < l.outFrame)
    .map((l) => ({ op: "splitLayer", layerId: l.id, frame: playhead }));
}

/** 詰める（AE の「シーケンスレイヤー」）＝選んだものを時間の順に隙間なく並べ直す。いちばん早いものは動かさない。 */
export function sequenceOps(comp: Composition, ids: ReadonlySet<string>): Op[] {
  const ls = editable(comp, ids).sort((a, b) => a.inFrame - b.inFrame || a.outFrame - b.outFrame);
  const ops: Op[] = [];
  let at = ls[0]?.inFrame ?? 0;
  for (const l of ls) {
    const delta = at - l.inFrame;
    if (delta !== 0) ops.push({ op: "updateLayer", layerId: l.id, patch: shiftPatch(l, delta) });
    at += l.outFrame - l.inFrame;
  }
  return ops;
}

/** 消す（`Delete`）。 */
export function removeOps(comp: Composition, ids: ReadonlySet<string>): Op[] {
  return editable(comp, ids).map((l) => ({ op: "removeLayer", layerId: l.id }));
}

/**
 * 消して詰める（`Shift+Delete`）＝消して、後ろのレイヤー（消したものの終わり以降に始まるもの）をその長さだけ前へ。
 * いくつか消すときは、そのレイヤーより前で終わる消したものの長さを足した分だけ前へ。
 */
export function rippleRemoveOps(comp: Composition, ids: ReadonlySet<string>): Op[] {
  const removed = editable(comp, ids);
  if (removed.length === 0) return [];
  const gone = new Set(removed.map((l) => l.id));
  const ops: Op[] = removed.map((l) => ({ op: "removeLayer", layerId: l.id }));
  for (const l of comp.layers) {
    if (gone.has(l.id) || l.locked) continue;
    const pull = removed.filter((r) => r.outFrame <= l.inFrame).reduce((s, r) => s + (r.outFrame - r.inFrame), 0);
    if (pull > 0) ops.push({ op: "updateLayer", layerId: l.id, patch: shiftPatch(l, -pull) });
  }
  return ops;
}

/**
 * 重なりの順を1つ動かす（`Ctrl+]`＝手前へ・`Ctrl+[`＝奥へ）。並びは先頭が最前面。
 * まとめて動かすときは、ぶつかる側から順に動かして互いを追い越さない。
 */
export function stackStepOps(comp: Composition, ids: ReadonlySet<string>, dir: "forward" | "backward"): Op[] {
  const order = comp.layers.map((l) => l.id);
  const picked = order.filter((id) => ids.has(id));
  const seq = dir === "forward" ? picked : [...picked].reverse();
  const ops: Op[] = [];
  for (const id of seq) {
    const i = order.indexOf(id);
    const j = dir === "forward" ? i - 1 : i + 1;
    if (j < 0 || j >= order.length || ids.has(order[j])) continue;
    order.splice(i, 1);
    order.splice(j, 0, id);
    ops.push({ op: "moveLayer", layerId: id, index: j });
  }
  return ops;
}

/** 名前の列を掴んで上下へ＝`to`（0＝最前面）へ置く。同じ所なら何もしない。 */
export function reorderOps(comp: Composition, id: string, to: number): Op[] {
  const from = comp.layers.findIndex((l) => l.id === id);
  if (from < 0) return [];
  const index = Math.max(0, Math.min(comp.layers.length - 1, to));
  return index === from ? [] : [{ op: "moveLayer", layerId: id, index }];
}

/** 切り替え（目・ソロ・錠）と名前の変更。 */
export function toggleOp(l: Layer, key: "enabled" | "solo" | "locked" | "motionBlur"): Op {
  const now = key === "solo" || key === "motionBlur" ? l[key] === true : l[key];
  return { op: "updateLayer", layerId: l.id, patch: { [key]: !now } };
}

/** コンポジションのモーションブラーのスイッチ（MV-0013 決定4）。設定（角・位相・数）は残す。 */
export function compBlurOp(comp: Composition): Op {
  return {
    op: "updateComposition",
    compositionId: comp.id,
    patch: { motionBlur: { enabled: comp.motionBlur?.enabled !== true } },
  };
}

export function renameOp(l: Layer, name: string): Op | null {
  const n = name.trim();
  return n === "" || n === l.name ? null : { op: "updateLayer", layerId: l.id, patch: { name: n } };
}

/**
 * 親を付ける・外す（MV-0010 決定5）＝見た目を保つ（Rust の `setParent`・今の時刻で）。
 * 同じ親なら何もしない。
 */
export function setParentOp(l: Layer, parentId: string | null, playhead: number): Op | null {
  if ((l.parentId ?? null) === parentId) return null;
  return { op: "setParent", layerId: l.id, parentId, frame: playhead };
}

/** 親にできるレイヤー（自分と、自分の子孫は輪になるので除く）。並びの順。 */
export function parentCandidates(comp: Composition, id: string): Layer[] {
  const parentOf = new Map(comp.layers.map((l) => [l.id, l.parentId ?? null]));
  const descends = (x: string): boolean => {
    let cur: string | null = x;
    for (let i = 0; i <= comp.layers.length && cur; i += 1) {
      if (cur === id) return true;
      cur = parentOf.get(cur) ?? null;
    }
    return false;
  };
  return comp.layers.filter((l) => !descends(l.id));
}

/**
 * プリコンポーズ（MV-0011 決定5）＝選んだものを新しいコンポジションへ移し、入れ子1つに置き換える。
 * 錠のかかったものは移さない。並びの順で渡す（中の並びもそのまま）。
 */
export function precomposeOp(comp: Composition, ids: ReadonlySet<string>, name: string): Op | null {
  const layerIds = editable(comp, ids).map((l) => l.id);
  return layerIds.length === 0 ? null : { op: "precompose", layerIds, name };
}

/** 時刻を持つレイヤー（映像・音・入れ子）＝速度・タイムリマップを持てる（MV-0012 決定3）。 */
export function isTimed(l: Layer): boolean {
  return l.type === "video" || l.type === "audio" || l.type === "precomp";
}

/**
 * 速度（%）＝タイムリマップが無ければ 100・直線のキーフレーム2つなら傾き。
 * それ以外（固定値・3つ以上・直線でない・式）は null＝細かいリマップ（MV-0012 決定4）。
 */
export function speedOf(l: Layer, fps: number): number | null {
  const r = l.timeRemap;
  if (!r) return 100;
  const ks = r.keyframes;
  if (r.expression || !ks || ks.length !== 2 || ks[0].interpolation !== "linear") return null;
  const [a, b] = ks;
  if (typeof a.value !== "number" || typeof b.value !== "number" || b.frame === a.frame) return null;
  return (((b.value - a.value) * fps) / (b.frame - a.frame)) * 100;
}

/** 速度を変える（0・時刻を持たない・錠は null）。 */
export function setSpeedOp(l: Layer, percent: number): Op | null {
  if (!isTimed(l) || l.locked || !Number.isFinite(percent) || percent === 0) return null;
  return { op: "setSpeed", layerId: l.id, percent };
}

/** タイムリマップの入り切り（`Ctrl+Alt+T`＝AE と同じ）。選んだ時刻を持つレイヤーごとに、今と逆へ。 */
export function toggleTimeRemapOps(comp: Composition, ids: ReadonlySet<string>): Op[] {
  return editable(comp, ids)
    .filter(isTimed)
    .map((l) => ({ op: "enableTimeRemap", layerId: l.id, enabled: !l.timeRemap }));
}

/** 範囲の選択（`Shift`＝基点からの間を全部）。並びの順で返す。 */
export function rangeSelect(comp: Composition, anchor: string, to: string): string[] {
  const ids = comp.layers.map((l) => l.id);
  const a = ids.indexOf(anchor);
  const b = ids.indexOf(to);
  if (a < 0 || b < 0) return [to];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return ids.slice(lo, hi + 1);
}

/**
 * 掴んでいる途中の見え方＝試しの `updateLayer` を当てた写し（JSON Merge Patch＝Rust の取引と同じ当て方）。
 * ⚠️ プレビューは Rust が試しを描くが、**タイムラインの帯とキーの◆も一緒に動かす**（離すまで止まって見えないように）。
 * 並びを変える・消す・分ける編集は見え方に当てない（離したあと読み直したものを描く）。
 */
export function withTrial(layers: readonly Layer[], ops: readonly Op[]): Layer[] {
  let out = [...layers];
  for (const o of ops) {
    if (o.op !== "updateLayer") continue;
    out = out.map((l) => (l.id === o.layerId ? (mergePatch(l, o.patch) as Layer) : l));
  }
  return out;
}

/** JSON Merge Patch（RFC 7386＝Rust の `tx::merge_patch` と同じ）。元は変えない。 */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const base =
    target !== null && typeof target === "object" && !Array.isArray(target) ? { ...(target as object) } : {};
  const out = base as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

