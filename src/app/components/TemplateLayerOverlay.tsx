import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Layer } from "../../domain/template/types";
import { FREE_MIN_SIZE, moveFreeElement, resizeFreeElement, type ResizeCorner } from "../../domain/project/freeLayoutOps";
import { edgesOf, snapToTargets, SNAP_THRESHOLD_PX, type SnapEdges } from "../../domain/project/freeSnap";

// テンプレ作成エディタのレイヤーをプレビュー上でドラッグ/リサイズ/吸着するオーバーレイ（ADR-0017・#214 ③c）。
// ①の FREE オーバーレイ（FreeElement 専用）は無改変のまま、移動/リサイズ/吸着の「純粋関数」（{x,y,w,h} を受ける）を
// Layer 編集へ流用する＝合意済みの「専用オーバーレイ＋純粋ops流用」。ScenePreview に重ねる（呼び出し側が position:relative）。
interface DragState {
  id: string;
  mode: "move" | "resize";
  corner?: ResizeCorner;
  startClientX: number;
  startClientY: number;
  start: { x: number; y: number; w: number; h: number };
  /** move 時の吸着先＝他レイヤーの辺・中心（ドラッグ開始時に確定）。 */
  otherEdges: SnapEdges[];
  scale: number; // 表示px / canvas
}

const HANDLES: { corner: ResizeCorner; left: string; top: string; cursor: string }[] = [
  { corner: "nw", left: "0%", top: "0%", cursor: "nwse-resize" },
  { corner: "ne", left: "100%", top: "0%", cursor: "nesw-resize" },
  { corner: "sw", left: "0%", top: "100%", cursor: "nesw-resize" },
  { corner: "se", left: "100%", top: "100%", cursor: "nwse-resize" },
];
const SNAP_GUIDE_COLOR = "#ff3d8b";

interface Props {
  layers: Layer[];
  canvasW: number;
  canvasH: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** ドラッグ/リサイズ中、新しい位置・大きさ（canvas 座標）を返す。 */
  onChange: (id: string, geom: { x: number; y: number; w?: number; h?: number }) => void;
  /** レイヤーのユーザー向けラベル（種別名）。 */
  label: (layer: Layer) => string;
}

export function TemplateLayerOverlay({ layers, canvasW, canvasH, selectedId, onSelect, onChange, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

  const beginDrag = (e: ReactPointerEvent, layer: Layer, mode: "move" | "resize", corner?: ResizeCorner) => {
    if (e.button !== 0) return; // 左ボタンのみ
    e.preventDefault();
    e.stopPropagation();
    onSelect(layer.id);
    const width = ref.current?.clientWidth ?? canvasW;
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
    setDrag({
      id: layer.id, mode, corner,
      startClientX: e.clientX, startClientY: e.clientY,
      start: { x: layer.x, y: layer.y, w: layer.w, h: layer.h },
      otherEdges: mode === "move" ? layers.filter((l) => l.id !== layer.id).map((l) => edgesOf(l)) : [],
      scale: width / canvasW,
    });
  };

  const handleMove = (e: ReactPointerEvent) => {
    if (!drag || drag.scale <= 0) return;
    e.preventDefault();
    const dx = (e.clientX - drag.startClientX) / drag.scale;
    const dy = (e.clientY - drag.startClientY) / drag.scale;
    if (drag.mode === "move") {
      // 移動＝純粋 moveFreeElement、さらに他レイヤーへ吸着（純粋 snapToTargets）。①の資産を流用。
      const moved = moveFreeElement(drag.start, dx, dy, 0);
      const snap = snapToTargets(
        { x: moved.x, y: moved.y, w: drag.start.w, h: drag.start.h },
        drag.otherEdges,
        SNAP_THRESHOLD_PX / drag.scale,
      );
      onChange(drag.id, { x: snap.x, y: snap.y });
      setGuides({ x: snap.guideX, y: snap.guideY });
    } else if (drag.corner) {
      // リサイズ＝純粋 resizeFreeElement（Shift で縦横比維持）。
      onChange(drag.id, resizeFreeElement(drag.start, drag.corner, dx, dy, FREE_MIN_SIZE, 0, e.shiftKey));
    }
  };

  const endDrag = (e: ReactPointerEvent) => {
    if (!drag) return;
    try { ref.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    setDrag(null);
    setGuides({ x: null, y: null });
  };

  return (
    <div
      ref={ref}
      style={{ position: "absolute", inset: 0, touchAction: "none" }}
      onPointerMove={handleMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // 何もない所を押したら選択解除（レイヤー/ハンドルの onPointerDown は stopPropagation 済み）。
      onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
    >
      {[...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)).map((l) => {
        const selected = l.id === selectedId;
        return (
          <div
            key={l.id}
            onPointerDown={(e) => beginDrag(e, l, "move")}
            style={{
              position: "absolute",
              left: `${(l.x / canvasW) * 100}%`,
              top: `${(l.y / canvasH) * 100}%`,
              width: `${(l.w / canvasW) * 100}%`,
              height: `${(l.h / canvasH) * 100}%`,
              boxSizing: "border-box",
              border: selected ? "2px solid var(--color-primary)" : "1px dashed rgba(0,0,0,0.4)",
              background: selected ? "rgba(80,130,255,0.08)" : "transparent",
              cursor: "move",
            }}
          >
            <span style={{ position: "absolute", top: 0, left: 0, fontSize: 11, background: "rgba(0,0,0,0.55)", color: "#fff", padding: "0 4px", borderRadius: 2, pointerEvents: "none", whiteSpace: "nowrap" }}>
              {label(l)}
            </span>
            {selected &&
              HANDLES.map((hd) => (
                <div
                  key={hd.corner}
                  onPointerDown={(e) => beginDrag(e, l, "resize", hd.corner)}
                  style={{ position: "absolute", left: hd.left, top: hd.top, width: 12, height: 12, transform: "translate(-50%, -50%)", background: "#fff", border: "2px solid var(--color-primary)", borderRadius: 2, cursor: hd.cursor }}
                />
              ))}
          </div>
        );
      })}
      {guides.x != null && (
        <div data-testid="tmpl-snap-guide-x" style={{ position: "absolute", left: `${(guides.x / canvasW) * 100}%`, top: 0, bottom: 0, width: 1, background: SNAP_GUIDE_COLOR, pointerEvents: "none", zIndex: 40 }} />
      )}
      {guides.y != null && (
        <div data-testid="tmpl-snap-guide-y" style={{ position: "absolute", top: `${(guides.y / canvasH) * 100}%`, left: 0, right: 0, height: 1, background: SNAP_GUIDE_COLOR, pointerEvents: "none", zIndex: 40 }} />
      )}
    </div>
  );
}
