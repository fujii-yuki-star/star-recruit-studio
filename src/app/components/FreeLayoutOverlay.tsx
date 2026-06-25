import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { FreeElement } from "../../domain/project/types";
import { FREE_MIN_SIZE, moveFreeElement, resizeFreeElement, type ResizeCorner } from "../../domain/project/freeLayoutOps";

// 仕上がり確認（ScenePreview）に重ねる自由配置の操作レイヤ（Phase 4b）。
// ScenePreview は width:100% / aspect-ratio をテンプレ canvas（向き）に合わせて SVG を充填するため
// レターボックスが無く、要素の矩形は %（canvasW/canvasH 基準）でプレビューに正確に重なる。
// ドラッグ/リサイズはルートで pointer capture し、マウス座標 px をドラッグ開始時の縮尺で canvas 座標へ換算する。

interface DragState {
  id: string;
  mode: "move" | "resize";
  corner?: ResizeCorner;
  startClientX: number;
  startClientY: number;
  start: { x: number; y: number; w: number; h: number };
  scale: number; // 表示px / canvas（= overlay幅 / canvas幅）
}

// 角ハンドルの位置（％）とカーソル。
const HANDLES: { corner: ResizeCorner; left: string; top: string; cursor: string }[] = [
  { corner: "nw", left: "0%", top: "0%", cursor: "nwse-resize" },
  { corner: "ne", left: "100%", top: "0%", cursor: "nesw-resize" },
  { corner: "sw", left: "0%", top: "100%", cursor: "nesw-resize" },
  { corner: "se", left: "100%", top: "100%", cursor: "nwse-resize" },
];

interface OverlayProps {
  freeLayout: FreeElement[];
  canvasW: number;
  canvasH: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** ドラッグ/リサイズ中、新しい位置・大きさ（canvas 座標）を返す。 */
  onChange: (id: string, geom: { x: number; y: number; w?: number; h?: number }) => void;
  /** グリッド吸着サイズ（canvas px・0=吸着なし）。 */
  gridSize?: number;
}

export function FreeLayoutOverlay({
  freeLayout, canvasW, canvasH, selectedId, onSelect, onChange, gridSize = 0,
}: OverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  // ルートで pointer capture することで、要素/ハンドルの押下後はドラッグがプレビュー外に出ても追従する。
  const beginDrag = (
    e: ReactPointerEvent, el: FreeElement, mode: "move" | "resize", corner?: ResizeCorner,
  ) => {
    e.preventDefault();
    e.stopPropagation(); // 角ハンドルのドラッグが本体の移動を兼ねないように
    onSelect(el.id);
    const width = ref.current?.clientWidth ?? canvasW;
    // capture は best-effort（環境により失敗しうる）。失敗してもルートの onPointerMove で追従する。
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
    setDrag({
      id: el.id, mode, corner,
      startClientX: e.clientX, startClientY: e.clientY,
      start: { x: el.x, y: el.y, w: el.w, h: el.h },
      // 表示px→canvas の縮尺。プレビューは canvas と同比（向きに追従・レターボックス無し）ゆえ scaleX===scaleY なので
      // 幅基準（width/canvasW）で算出すれば縦も一致する（canvasH は %配置に使用）。
      scale: width / canvasW,
    });
  };

  const handleMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    e.preventDefault(); // ドラッグ中のテキスト選択等の既定動作を抑制（beginDrag と一貫）
    const dx = (e.clientX - drag.startClientX) / drag.scale;
    const dy = (e.clientY - drag.startClientY) / drag.scale;
    if (drag.mode === "move") {
      onChange(drag.id, moveFreeElement(drag.start, dx, dy, gridSize));
    } else if (drag.corner) {
      // Shift 押下中は縦横比を維持（e.shiftKey は move のたびに評価＝ドラッグ途中の押し直しにも追従）。
      onChange(drag.id, resizeFreeElement(drag.start, drag.corner, dx, dy, FREE_MIN_SIZE, gridSize, e.shiftKey));
    }
  };

  const endDrag = (e: ReactPointerEvent) => {
    if (!drag) return;
    try { ref.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    setDrag(null);
  };

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        inset: 0,
        touchAction: "none",
        // グリッド吸着 ON のとき薄いグリッド線を表示（canvas px → % で線を引く）。
        ...(gridSize > 0
          ? {
              backgroundImage:
                "linear-gradient(to right, rgba(0,0,0,0.10) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.10) 1px, transparent 1px)",
              backgroundSize: `${(gridSize / canvasW) * 100}% ${(gridSize / canvasH) * 100}%`,
            }
          : {}),
      }}
      onPointerMove={handleMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // 何もない所を押したら選択解除（要素/ハンドルの onPointerDown は stopPropagation 済み）。
      onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
    >
      {freeLayout.map((el) => {
        const selected = el.id === selectedId;
        return (
          <div
            key={el.id}
            onPointerDown={(e) => beginDrag(e, el, "move")}
            style={{
              position: "absolute",
              left: `${(el.x / canvasW) * 100}%`,
              top: `${(el.y / canvasH) * 100}%`,
              width: `${(el.w / canvasW) * 100}%`,
              height: `${(el.h / canvasH) * 100}%`,
              boxSizing: "border-box",
              border: selected ? "2px solid var(--color-primary)" : "1px dashed rgba(0,0,0,0.4)",
              background: selected ? "rgba(80,130,255,0.08)" : "transparent",
              cursor: "move",
            }}
          >
            {selected &&
              HANDLES.map((hd) => (
                <div
                  key={hd.corner}
                  onPointerDown={(e) => beginDrag(e, el, "resize", hd.corner)}
                  style={{
                    position: "absolute",
                    left: hd.left,
                    top: hd.top,
                    width: 12,
                    height: 12,
                    transform: "translate(-50%, -50%)",
                    background: "#fff",
                    border: "2px solid var(--color-primary)",
                    borderRadius: 2,
                    cursor: hd.cursor,
                  }}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
