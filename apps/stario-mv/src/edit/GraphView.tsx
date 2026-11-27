import { useRef, useState } from "react";
import {
  handleFromSpeed,
  handleFromValue,
  setHandleOp,
  setKeyValueOp,
  speedAt,
  speedHandles,
  valueAt,
  valueHandles,
  valueRange,
  type GraphHandle,
} from "./graph";
import { keysAt, pathLabel, type KeyPath } from "./keyframes";
import { frameToX } from "./timelineMath";
import { withTrial } from "./layerOps";
import type { Layer, Op } from "./types";

export type GraphMode = "value" | "speed";

/** 上下の余白（画素）。 */
const PAD = 16;
/** 成分の線の色（x・y）。 */
const COLORS = ["#e06c75", "#7fc77f"];

type Drag =
  | { kind: "handle"; h: GraphHandle; range: [number, number]; ops: Op[] }
  | { kind: "key"; i: number; comp: number; range: [number, number]; ops: Op[] };

/**
 * イージングのグラフ（MV-0015）＝帯の場所に、値か速さの線と取っ手を描く。横は時間の目盛りと同じ（`frameToX`）。
 * 掴んでいる間は試し・離すと1つの取引。⚠️ 動かした先の値は、掴んだときのレイヤーから求める（試しの絵を元にしない）。
 */
export function GraphView(props: {
  /** 試しを当てた（描く）レイヤー。 */
  layer: Layer;
  /** 掴んだときに元にするレイヤー（試しを当てていない）。 */
  base: Layer;
  path: KeyPath;
  fps: number;
  ppf: number;
  durationFrames: number;
  height: number;
  mode: GraphMode;
  onMode: (m: GraphMode) => void;
  onTrial: (ops: Op[] | null) => void;
  onCommit: (ops: Op[]) => unknown;
}): React.JSX.Element {
  const { path, fps, ppf, mode } = props;
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // 掴んでいる間は、試しを当てた線で描く（離すまで止まって見えない）
  const layer = drag && drag.ops.length > 0 ? (withTrial([props.base], drag.ops)[0] ?? props.layer) : props.layer;
  const keys = keysAt(layer, path);
  const width = frameToX(props.durationFrames, ppf);
  const h = Math.max(60, props.height - 28);

  // 線（2 画素ごと・キーの時刻も必ず通る）
  const step = Math.max(0.25, 2 / ppf);
  const frames: number[] = [];
  for (let f = 0; f <= props.durationFrames; f += step) frames.push(f);
  for (const k of keys) frames.push(k.frame);
  frames.sort((a, b) => a - b);
  const dims = keys.length > 0 && Array.isArray(keys[0].value) ? keys[0].value.length : 1;
  const series: { f: number; v: number }[][] =
    mode === "value"
      ? Array.from({ length: dims }, (_, c) => frames.map((f) => ({ f, v: valueAt(keys, f)[c] ?? 0 })))
      : [frames.map((f) => ({ f, v: speedAt(keys, f, fps) }))];
  const handles = mode === "value" ? valueHandles(keys) : speedHandles(keys, fps);
  const keyPts =
    mode === "value"
      ? keys.flatMap((k, i) => (Array.isArray(k.value) ? k.value : [k.value]).map((v, comp) => ({ i, comp, f: k.frame, v })))
      : [];
  const range: [number, number] =
    drag?.range ?? valueRange([...series.flat().map((p) => p.v), ...handles.map((x) => x.at.value), ...keyPts.map((p) => p.v)]);
  const [lo, hi] = range;
  const y = (v: number): number => PAD + ((hi - v) / (hi - lo)) * (h - 2 * PAD);
  const x = (f: number): number => frameToX(f, ppf);

  /** 画面の位置 → (フレーム, 値)（掴んだときの縦の範囲で）。 */
  const at = (e: React.PointerEvent, r: [number, number]): { frame: number; value: number } => {
    const rect = svg.current?.getBoundingClientRect();
    const px = e.clientX - (rect?.left ?? 0);
    const py = e.clientY - (rect?.top ?? 0);
    return { frame: px / ppf, value: r[1] - ((py - PAD) / (h - 2 * PAD)) * (r[1] - r[0]) };
  };

  const start = (e: React.PointerEvent, d: Drag): void => {
    if (e.button !== 0 || props.base.locked) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag(d);
  };
  const onMove = (e: React.PointerEvent): void => {
    if (!drag) return;
    const to = at(e, drag.range);
    // ⚠️ 掴んだときのレイヤーから求める。取っ手を動かしてもキーの時刻と値は変わらないので、試しの絵から求めても同じ数になる
    //   （変異チェックで「同じ結果」と確かめた）＝試しを重ねて当てないための書き方
    const baseKeys = keysAt(props.base, path);
    let op: Op | null;
    if (drag.kind === "handle") {
      const handle = mode === "value" ? handleFromValue(baseKeys, drag.h, to) : handleFromSpeed(baseKeys, drag.h, to, fps);
      op = setHandleOp(props.base, path, drag.h, handle);
    } else {
      op = setKeyValueOp(props.base, path, drag.i, drag.comp, to.value);
    }
    const ops = op ? [op] : [];
    props.onTrial(ops.length > 0 ? ops : null);
    setDrag({ ...drag, ops });
  };
  const onUp = (): void => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.ops.length > 0) props.onCommit(d.ops);
    else props.onTrial(null);
  };

  const line = (pts: { f: number; v: number }[]): string => pts.map((p) => `${x(p.f).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

  return (
    <div className="graph" data-testid="graph">
      <div className="graph-head">
        <span className="graph-title">
          {pathLabel(layer, path)}（{layer.name}）
        </span>
        <button type="button" aria-pressed={mode === "value"} onClick={() => props.onMode("value")}>
          値
        </button>
        <button type="button" aria-pressed={mode === "speed"} onClick={() => props.onMode("speed")}>
          速さ
        </button>
      </div>
      <svg
        ref={svg}
        className="graph-svg"
        width={width}
        height={h}
        data-testid="graph-svg"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {series.map((pts, c) => (
          <polyline
            key={c}
            points={line(pts)}
            fill="none"
            stroke={mode === "value" ? COLORS[c % COLORS.length] : "#d0d4da"}
            strokeWidth={1.5}
            data-testid={`graph-line-${c}`}
          />
        ))}
        {handles.map((hd) => {
          const id = `${hd.side}-${hd.i}-${hd.comp}`;
          return (
            <g key={id}>
              <line x1={x(hd.from.frame)} y1={y(hd.from.value)} x2={x(hd.at.frame)} y2={y(hd.at.value)} stroke="#8a90a0" />
              <circle
                cx={x(hd.at.frame)}
                cy={y(hd.at.value)}
                r={5}
                className="graph-handle"
                data-testid={`graph-handle-${id}`}
                aria-label={hd.side === "out" ? "出の取っ手" : "入りの取っ手"}
                onPointerDown={(e) => start(e, { kind: "handle", h: hd, range, ops: [] })}
              />
            </g>
          );
        })}
        {keyPts.map((p) => (
          <rect
            key={`${p.i}-${p.comp}`}
            x={x(p.f) - 4}
            y={y(p.v) - 4}
            width={8}
            height={8}
            className="graph-key"
            data-testid={`graph-key-${p.i}-${p.comp}`}
            onPointerDown={(e) => start(e, { kind: "key", i: p.i, comp: p.comp, range, ops: [] })}
          />
        ))}
        {mode === "speed" &&
          keys.map((k) => <rect key={k.frame} x={x(k.frame) - 3} y={h - 8} width={6} height={6} className="graph-tick" />)}
      </svg>
    </div>
  );
}
