import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { moveOps, rangeSelect, renameOp, reorderOps, toggleOp, trimInOps, trimOutOps, withTrial } from "./layerOps";
import { fitPxPerFrame, frameToX, snapOffset, snapTargets, xToFrame, zoomed } from "./timelineMath";
import { keyFramesOf } from "./props";
import type { Composition, Layer, Op } from "./types";

/** 行の高さ・名前の列の幅・目盛りの高さ（画素）。 */
export const ROW_H = 26;
export const NAME_W = 240;
export const RULER_H = 24;
/** 帯の端を掴める幅（画素）。 */
export const EDGE_PX = 6;
/** 見えている行の上下に余分に描く行の数。 */
const OVERSCAN = 6;

export interface TimelineProps {
  comp: Composition;
  playhead: number;
  selected: ReadonlySet<string>;
  /** 範囲選択の基点（最後に1つだけ選んだもの）。 */
  anchor: string | null;
  snapping: boolean;
  onSelect: (ids: string[], anchor: string | null) => void;
  onSeek: (frame: number) => void;
  /** 掴んで動かしている途中（保存しない）。`null` でやめる。 */
  onTrial: (ops: Op[] | null) => void;
  /** 離した・確定した＝1つの取引。反映できたかを返す（断られたら帯を元に戻す）。 */
  onCommit: (ops: Op[]) => Promise<boolean> | void;
}

type Drag =
  | {
      kind: "move" | "in" | "out";
      id: string;
      x0: number;
      moved: boolean;
      ops: Op[];
      /** 選んでいるものの1つを押した＝動かさずに離したら、それだけを選び直す（AE の型）。 */
      narrowOnClick: boolean;
    }
  | { kind: "order"; id: string; y0: number; from: number; to: number; moved: boolean };

/**
 * タイムライン（MV-0008 決定3・4）＝左にレイヤーの名前と切り替え、右に時間の目盛りと帯・今の時刻の線。
 * ⚠️ 帯は見えている行だけ描く（画面の部品＝DOM）。並びは先頭が最前面（上の行）。
 */
export function Timeline(props: TimelineProps): React.JSX.Element {
  const { comp, playhead, selected, anchor, snapping } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [ppf, setPpf] = useState(1);
  const [view, setView] = useState({ top: 0, height: 400 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // 離してから読み直しが届くまでの間も、帯を離した位置に描く（元の位置へ一瞬戻らない）。
  // ⚠️ 状態を消すのに effect を使わない＝「どの並びを見ていたときの試しか」を持ち、並びが替われば使わない
  const [settling, setSettling] = useState<{ base: readonly Layer[]; ops: Op[] } | null>(null);
  const zoomAnchor = useRef<{ frame: number; offset: number } | null>(null);

  // 開いたコンポジションは、欄の幅に全体が収まる大きさで始める
  useLayoutEffect(() => {
    const w = (scroller.current?.clientWidth ?? 0) - NAME_W;
    setPpf(fitPxPerFrame(w, comp.durationFrames));
  }, [comp.id, comp.durationFrames]);

  // Alt＋ホイール＝拡大・縮小（カーソルの下のフレームを動かさない）。⚠️ 受け身でない聞き方でないと既定の動きを止められない
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.altKey) return;
      e.preventDefault();
      const offset = e.clientX - el.getBoundingClientRect().left - NAME_W;
      setPpf((p) => {
        zoomAnchor.current = { frame: (el.scrollLeft + offset) / p, offset };
        return zoomed(p, e.deltaY);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = zoomAnchor.current;
    if (el && a) el.scrollLeft = Math.max(0, a.frame * ppf - a.offset);
    zoomAnchor.current = null;
  }, [ppf]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = (): void => setView({ top: el.scrollTop, height: el.clientHeight || 400 });
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const layers = comp.layers;
  // 掴んでいる途中は、帯を試しの位置に描く（保存はまだ＝離したら1つの取引）
  const pending =
    drag && drag.kind !== "order" && drag.ops.length > 0
      ? drag.ops
      : settling && settling.base === layers
        ? settling.ops
        : null;
  const shown = pending ? withTrial(layers, pending) : layers;
  const first = Math.max(0, Math.floor((view.top - RULER_H) / ROW_H) - OVERSCAN);
  const last = Math.min(layers.length, Math.ceil((view.top + view.height) / ROW_H) + OVERSCAN);
  const width = NAME_W + frameToX(comp.durationFrames, ppf) + 40;

  const select = (l: Layer, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void => {
    if (e.shiftKey && anchor) {
      props.onSelect(rangeSelect(comp, anchor, l.id), anchor);
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(l.id)) next.delete(l.id);
      else next.add(l.id);
      props.onSelect([...next], l.id);
    } else {
      props.onSelect([l.id], l.id);
    }
  };

  // ── 帯を掴む（ずらす・端を切る） ──
  const startBar = (e: React.PointerEvent, l: Layer): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // ⚠️ 選んでいるものの1つを押したときは、押した瞬間に選択を縮めない＝そのまままとめて動かせる（AE の型）
    const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey;
    const narrowOnClick = plain && selected.has(l.id) && selected.size > 1;
    if (!narrowOnClick) select(l, e);
    // ⚠️ 錠は二重に守る＝操作を組み立てる側（layerOps の editable）も錠を除くので、ここを外しても動かない
    //   （変異チェックで「同じ結果」と確かめた・2026-11-27）。ここは掴んだ手応えを出さないための入口。
    if (l.locked) {
      if (narrowOnClick) props.onSelect([l.id], l.id);
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left;
    const kind = x <= EDGE_PX ? "in" : x >= r.width - EDGE_PX ? "out" : "move";
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ kind, id: l.id, x0: e.clientX, moved: false, ops: [], narrowOnClick });
  };

  const barOps = (d: Extract<Drag, { kind: "move" | "in" | "out" }>, clientX: number): Op[] => {
    const l = layers.find((x) => x.id === d.id);
    if (!l) return [];
    const df = xToFrame(clientX - d.x0, ppf);
    if (d.kind === "move") {
      // ⚠️ 選んでいるもの全部を同じだけ動かす（掴んだものが選ばれていなければそれだけ）
      const ids = selected.has(l.id) ? selected : new Set([l.id]);
      const snap = snapping
        ? snapOffset([l.inFrame + df, l.outFrame + df], snapTargets(comp, playhead, ids), ppf)
        : 0;
      return moveOps(comp, ids, df + snap);
    }
    const only = new Set([l.id]);
    const edge = (d.kind === "in" ? l.inFrame : l.outFrame) + df;
    const snapped = snapping ? edge + snapOffset([edge], snapTargets(comp, playhead, only), ppf) : edge;
    return d.kind === "in" ? trimInOps(comp, only, snapped) : trimOutOps(comp, only, snapped);
  };

  // ── 名前の列を掴んで上下へ（重なりの順） ──
  const startName = (e: React.PointerEvent, l: Layer, index: number): void => {
    if (e.button !== 0 || renaming === l.id) return;
    if ((e.target as HTMLElement).closest("button, input")) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ kind: "order", id: l.id, y0: e.clientY, from: index, to: index, moved: false });
  };

  const onMove = (e: React.PointerEvent): void => {
    if (!drag) return;
    if (drag.kind === "order") {
      const to = Math.max(0, Math.min(layers.length - 1, drag.from + Math.round((e.clientY - drag.y0) / ROW_H)));
      if (to !== drag.to || !drag.moved) setDrag({ ...drag, to, moved: drag.moved || to !== drag.from });
      return;
    }
    const ops = barOps(drag, e.clientX);
    if (JSON.stringify(ops) !== JSON.stringify(drag.ops)) {
      props.onTrial(ops.length > 0 ? ops : null);
      setDrag({ ...drag, ops, moved: true });
    }
  };

  const onUp = (e: React.PointerEvent): void => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === "order") {
      const l = layers.find((x) => x.id === d.id);
      if (!d.moved && l) select(l, e);
      const ops = reorderOps(comp, d.id, d.to);
      if (ops.length > 0) props.onCommit(ops);
      return;
    }
    if (d.ops.length > 0) {
      setSettling({ base: layers, ops: d.ops });
      // 断られたら（何も変わらない＝並びも替わらない）帯を元の位置へ戻す
      void Promise.resolve(props.onCommit(d.ops)).then((ok) => {
        if (ok === false) setSettling(null);
      });
    } else if (d.moved) props.onTrial(null);
    else if (d.narrowOnClick) props.onSelect([d.id], d.id);
  };

  // ── 目盛りと今の時刻の線（掴んで動かしている間もプレビューが追う） ──
  const seekAt = (e: React.PointerEvent, el: HTMLElement): void => {
    const x = e.clientX - el.getBoundingClientRect().left;
    props.onSeek(Math.max(0, Math.min(comp.durationFrames - 1, xToFrame(x, ppf))));
  };
  const [scrubbing, setScrubbing] = useState(false);

  const head = frameToX(playhead, ppf);
  const ticks = rulerTicks(comp, ppf);

  return (
    <div
      className="timeline"
      ref={scroller}
      data-testid="timeline"
      onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight || 400 })}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div className="tl-inner" style={{ width, height: RULER_H + layers.length * ROW_H }}>
        <div className="tl-ruler-row" style={{ height: RULER_H }}>
          <div className="tl-corner" style={{ width: NAME_W }}>
            {layers.length} レイヤー
          </div>
          <div
            className="tl-ruler"
            data-testid="ruler"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              setScrubbing(true);
              seekAt(e, e.currentTarget);
            }}
            onPointerMove={(e) => {
              if (scrubbing) seekAt(e, e.currentTarget);
            }}
            onPointerUp={() => setScrubbing(false)}
          >
            {ticks.map((t) => (
              <span key={t.frame} className="tl-tick" style={{ left: frameToX(t.frame, ppf) }}>
                {t.label}
              </span>
            ))}
            {comp.markers.map((m) => (
              <span key={m.id} className="tl-marker" style={{ left: frameToX(m.frame, ppf) }} title="マーカー" />
            ))}
          </div>
        </div>
        {shown.slice(first, last).map((l, k) => {
          const i = first + k;
          const isSel = selected.has(l.id);
          const dropTarget = drag?.kind === "order" && drag.moved && drag.to === i && drag.id !== l.id;
          return (
            <div
              key={l.id}
              className={`tl-row${isSel ? " selected" : ""}${dropTarget ? " drop" : ""}`}
              style={{ top: RULER_H + i * ROW_H, height: ROW_H }}
              data-testid={`row-${l.id}`}
            >
              <div
                className="tl-name"
                style={{ width: NAME_W }}
                onPointerDown={(e) => startName(e, l, i)}
                onDoubleClick={() => setRenaming(l.id)}
              >
                <button
                  type="button"
                  className="tl-toggle"
                  aria-label="表示"
                  aria-pressed={l.enabled}
                  title="表示（目）"
                  onClick={() => props.onCommit([toggleOp(l, "enabled")])}
                >
                  {l.enabled ? "●" : "○"}
                </button>
                <button
                  type="button"
                  className="tl-toggle"
                  aria-label="ソロ"
                  aria-pressed={l.solo === true}
                  title="ソロ（これだけ見る）"
                  onClick={() => props.onCommit([toggleOp(l, "solo")])}
                >
                  S
                </button>
                <button
                  type="button"
                  className="tl-toggle"
                  aria-label="錠"
                  aria-pressed={l.locked}
                  title="錠（編集から守る）"
                  onClick={() => props.onCommit([toggleOp(l, "locked")])}
                >
                  {l.locked ? "🔒" : "·"}
                </button>
                {renaming === l.id ? (
                  <input
                    className="tl-rename"
                    aria-label="レイヤーの名前"
                    defaultValue={l.name}
                    autoFocus
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        const op = renameOp(l, e.currentTarget.value);
                        setRenaming(null);
                        if (op) props.onCommit([op]);
                      } else if (e.key === "Escape") {
                        setRenaming(null);
                      }
                    }}
                    onBlur={() => setRenaming(null)}
                  />
                ) : (
                  <span className="tl-label" title={l.name}>
                    {l.name}
                  </span>
                )}
              </div>
              <div className="tl-track">
                <div
                  className={`tl-bar type-${l.type}${l.enabled ? "" : " off"}${l.locked ? " locked" : ""}`}
                  data-testid={`bar-${l.id}`}
                  style={{ left: frameToX(l.inFrame, ppf), width: Math.max(2, frameToX(l.outFrame - l.inFrame, ppf)) }}
                  onPointerDown={(e) => startBar(e, l)}
                  title={`${l.name}（${l.inFrame}〜${l.outFrame - 1}）`}
                />
                {/* キーのある時刻（掴んで動かすのは γ0.2＝MV-0008 決定5） */}
                {keyFramesOf(l).map((f) => (
                  <span
                    key={f}
                    className="tl-key"
                    data-testid={`key-${l.id}-${f}`}
                    style={{ left: frameToX(f, ppf) }}
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>
          );
        })}
        <div className="tl-playhead" data-testid="playhead" style={{ left: NAME_W + head }} />
      </div>
    </div>
  );
}

/** 目盛り（画素の間隔が詰まりすぎない秒の刻み）。 */
export function rulerTicks(comp: Composition, ppf: number): { frame: number; label: string }[] {
  const fps = comp.fps.num / comp.fps.den;
  const steps = [1 / fps, 0.5, 1, 2, 5, 10, 30, 60, 300];
  const step = steps.find((s) => s * fps * ppf >= 70) ?? 600;
  const out: { frame: number; label: string }[] = [];
  for (let t = 0; t * fps < comp.durationFrames; t += step) {
    const frame = Math.round(t * fps);
    const s = Math.floor(t);
    const f = frame - Math.round(s * fps);
    out.push({ frame, label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}${f ? `+${f}` : ""}` });
  }
  return out;
}
