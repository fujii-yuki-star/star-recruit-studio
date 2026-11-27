import { useEffect, useRef, useState } from "react";
import { previewApi } from "../preview/api";
import { editApi } from "./api";
import { dragDelta, movePositionOp, pickLayerAt, toPanel, toParentDelta, type Bounds, type Point } from "./overlay";
import type { AnimValue, Layer, Op } from "./types";

/**
 * プレビューの上に重ねる透明な面（MV-0008 決定6）。押すとその場所のいちばん手前のレイヤーを選び、選んだものの枠を描く。
 * 掴んで動かすと位置が動く（`Shift` で縦か横だけ）。キーフレームになっていれば今の時刻のキーを打つ。
 * ⚠️ 枠は Rust が描画の核で求める（ここで大きさや変形を書き写さない）。再生中は枠を出さない。
 */
export function PreviewOverlay(props: {
  panel: React.RefObject<HTMLDivElement | null>;
  layers: readonly Layer[];
  selectedId: string | null;
  frame: number;
  playing: boolean;
  /** 中身が変わった印（取り直すため）。 */
  docKey: unknown;
  onSelect: (id: string | null) => void;
  onTrial: (ops: Op[] | null) => void;
  onCommit: (ops: Op[]) => unknown;
}): React.JSX.Element | null {
  const { panel, layers, selectedId, frame, playing, docKey } = props;
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [size, setSize] = useState(0);
  const [drag, setDrag] = useState<{ x0: number; y0: number; dx: number; dy: number; shift: boolean } | null>(null);
  const start = useRef<{ layer: Layer; value: AnimValue | null; ops: Op[] } | null>(null);

  // 欄の大きさが変わったら取り直す
  useEffect(() => {
    const el = panel.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSize((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [panel]);

  useEffect(() => {
    if (playing) return;
    let alive = true;
    previewApi.bounds().then(
      (b) => {
        if (alive) setBounds(b);
      },
      () => {
        if (alive) setBounds(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [frame, playing, docKey, size]);

  const rect = (): DOMRect | null => panel.current?.getBoundingClientRect() ?? null;
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const locked = new Set(layers.filter((l) => l.locked).map((l) => l.id));

  const onDown = (e: React.PointerEvent): void => {
    const r = rect();
    if (!r || !bounds || e.button !== 0 || playing) return;
    const id = pickLayerAt(bounds, [e.clientX - r.left, e.clientY - r.top], r.left, r.top, dpr, locked);
    props.onSelect(id);
    const layer = layers.find((l) => l.id === id);
    if (!layer) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    start.current = { layer, value: null, ops: [] };
    // 掴んだときの位置（今の時刻の値）を Rust に求めてもらう
    void editApi.eval(layer, frame).then((v) => {
      if (start.current?.layer === layer) start.current.value = v["/transform/position"] ?? null;
    });
    setDrag({ x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, shift: e.shiftKey });
  };

  const onMove = (e: React.PointerEvent): void => {
    const s = start.current;
    if (!drag || !s || !bounds) return;
    const [dx, dy] = dragDelta(e.clientX - drag.x0, e.clientY - drag.y0, dpr, bounds.scale, e.shiftKey);
    // 画面で描く枠の移動（CSS 画素）
    const k = bounds.scale / dpr;
    setDrag({ ...drag, dx: dx * k, dy: dy * k, shift: e.shiftKey });
    if (s.value == null) return;
    // 位置は親の座標で書く＝親の向きと大きさの逆を通す（MV-0010 決定5）
    const parentLinear = bounds.layers.find((l) => l.layerId === s.layer.id)?.parentLinear;
    const local = toParentDelta([dx, dy], parentLinear);
    s.ops = dx === 0 && dy === 0 ? [] : [movePositionOp(s.layer, frame, s.value, local)];
    props.onTrial(s.ops.length > 0 ? s.ops : null);
  };

  const onUp = (): void => {
    const s = start.current;
    start.current = null;
    setDrag(null);
    if (s && s.ops.length > 0) props.onCommit(s.ops);
  };

  const r = rect();
  const sel = selectedId && bounds && r ? bounds.layers.find((l) => l.layerId === selectedId) : undefined;
  const pts =
    sel && r
      ? sel.corners.map((c) => {
          const [x, y] = toPanel(c, r.left, r.top, dpr);
          return [x + (drag?.dx ?? 0), y + (drag?.dy ?? 0)] as Point;
        })
      : null;

  return (
    <div
      className="preview-overlay"
      data-testid="preview-overlay"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {pts && !playing && (
        <svg className="sel-box" data-testid="selection-box" aria-hidden="true">
          <polygon points={pts.map((p) => p.join(",")).join(" ")} />
          {pts.map((p, i) => (
            <rect key={i} x={p[0] - 3} y={p[1] - 3} width={6} height={6} />
          ))}
        </svg>
      )}
    </div>
  );
}
