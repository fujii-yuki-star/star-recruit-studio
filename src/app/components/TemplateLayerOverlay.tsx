import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Layer } from "../../domain/template/types";
import { freeElementsInRect, moveFreeElement, resizeFreeElement, resizeRotatedFreeElement, rotationFromPointer, snapAngle, type FreeElementMove, type ResizeCorner } from "../../domain/project/freeLayoutOps";
import { edgesOf, snapToTargets, SNAP_THRESHOLD_PX, type SnapEdges } from "../../domain/project/freeSnap";
import { GEOM_MIN_SIZE } from "../../domain/constants";

// テンプレ作成エディタのレイヤーをプレビュー上でドラッグ/リサイズ/吸着＋複数選択するオーバーレイ（ADR-0017・#306）。
// ①の FREE オーバーレイの純粋 ops（{x,y,w,h} を受ける move/resize/snap、id 集合を返す freeElementsInRect）を Layer 編集へ流用する。
// 複数選択（Shift+クリック・マーキー）→ 一括移動。リサイズは主（末尾選択）のみ。グループ化は ④[#307] で本選択を土台に載せる。
interface DragState {
  id: string; // 主＝リサイズ対象・移動の基準
  mode: "move" | "resize" | "rotate";
  corner?: ResizeCorner;
  /** resize 時：開始時の回転角（度）。回転考慮リサイズの基準を開始時点に固定（#279）。 */
  rotation?: number;
  startClientX: number;
  startClientY: number;
  start: { x: number; y: number; w: number; h: number };
  /** move 時：一括移動する全レイヤーの開始位置（複数選択。単一なら主のみ）。beginDrag で常に設定。 */
  starts: { id: string; x: number; y: number }[];
  /** move 時の吸着先＝移動しない他レイヤーの辺・中心（開始時に確定）。 */
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

// 回転を考慮したリサイズカーソル（FREE #279 と同じ）：対角軸角度（nwse=45°/nesw=135°）＋回転を 45°単位で 4種へ丸める。
const RESIZE_CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];
function resizeCursor(corner: ResizeCorner, rotationDeg: number): string {
  const base = corner === "nw" || corner === "se" ? 45 : 135;
  const a = (((base + rotationDeg) % 180) + 180) % 180;
  return RESIZE_CURSORS[Math.round(a / 45) % 4];
}

interface Props {
  layers: Layer[];
  canvasW: number;
  canvasH: number;
  /** 選択中レイヤー id（複数選択・末尾が主＝リサイズ対象）。 */
  selectedIds: string[];
  /** 選択変更。additive=true（Shift+クリック）で選択トグル、false/未指定でその1つだけ、null で全解除。 */
  onSelect: (id: string | null, additive?: boolean) => void;
  /** 範囲選択（マーキー）：交差したレイヤー集合をまとめて選択にする。 */
  onSelectMany: (ids: string[]) => void;
  /** ドラッグ/リサイズ中、主の新しい位置・大きさ（canvas 座標）を返す。 */
  onChange: (id: string, geom: { x: number; y: number; w?: number; h?: number }) => void;
  /** 一括移動：複数選択の全レイヤーの新しい位置をまとめて返す（1回の更新）。 */
  onMoveMany: (moves: FreeElementMove[]) => void;
  /** 回転ハンドルのドラッグ中、レイヤーの新しい角度（度・0≤r<360）を返す（#279 同様）。 */
  onRotate: (id: string, rotation: number) => void;
  /** レイヤーのユーザー向けラベル（種別名）。 */
  label: (layer: Layer) => string;
}

export function TemplateLayerOverlay({ layers, canvasW, canvasH, selectedIds, onSelect, onSelectMany, onChange, onMoveMany, onRotate, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  // 範囲選択（マーキー）の矩形（canvas 座標・null=非アクティブ）。空白ドラッグで矩形を引き交差レイヤーを選択。
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // 主＝最後に選択したレイヤー（リサイズハンドルはこれだけに出す）。
  const primaryId = selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null;

  // ポインタの画面座標→canvas 座標（オーバーレイは fit 箱内＝実寸一致）。描画前(0幅)は原点に潰す。
  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return { x: 0, y: 0 };
    const scale = r.width / canvasW;
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  };

  const beginDrag = (e: ReactPointerEvent, layer: Layer, mode: "move" | "resize", corner?: ResizeCorner) => {
    if (e.button !== 0) return; // 左ボタンのみ
    e.preventDefault();
    e.stopPropagation();
    // Shift+クリック（移動操作）＝選択トグル。ドラッグは始めない（複数選択を作る/外す操作）。
    if (mode === "move" && e.shiftKey) { onSelect(layer.id, true); return; }
    // 通常クリック：未選択ならその1つを選択。選択済みをドラッグなら選択を保つ（複数なら一括移動）。
    const alreadySelected = selectedIds.includes(layer.id);
    if (!alreadySelected) onSelect(layer.id);
    const moveTargets = mode === "move" && alreadySelected ? selectedIds : [layer.id];
    const starts = moveTargets
      .map((id) => layers.find((l) => l.id === id))
      .filter((l): l is Layer => l != null)
      .map((l) => ({ id: l.id, x: l.x, y: l.y }));
    const width = ref.current?.clientWidth ?? canvasW;
    // pointer capture は best-effort（一部環境で例外）。失敗してもルートの onPointerMove で追従する。
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
    setDrag({
      id: layer.id, mode, corner,
      rotation: layer.rotation, // 回転考慮リサイズの基準（開始時点に固定・#279）
      startClientX: e.clientX, startClientY: e.clientY,
      start: { x: layer.x, y: layer.y, w: layer.w, h: layer.h },
      starts,
      // 吸着先＝移動しない他レイヤー（move のみ）。
      otherEdges: mode === "move" ? layers.filter((l) => !moveTargets.includes(l.id)).map((l) => edgesOf(l)) : [],
      scale: width / canvasW,
    });
  };

  // 回転ハンドル押下（#279 同様）：レイヤー中心からポインタへの角度で rotation を更新する。
  const beginRotate = (e: ReactPointerEvent, layer: Layer) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!selectedIds.includes(layer.id)) onSelect(layer.id);
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
    setDrag({
      id: layer.id, mode: "rotate",
      startClientX: e.clientX, startClientY: e.clientY,
      start: { x: layer.x, y: layer.y, w: layer.w, h: layer.h },
      starts: [], otherEdges: [],
      scale: (ref.current?.clientWidth ?? canvasW) / canvasW,
    });
  };

  const handleMove = (e: ReactPointerEvent) => {
    // 範囲選択（マーキー）中：矩形を広げ、交差するレイヤーを選択集合に反映。
    if (marquee) {
      e.preventDefault();
      const p = toCanvas(e.clientX, e.clientY);
      const next = { ...marquee, x1: p.x, y1: p.y };
      setMarquee(next);
      onSelectMany(freeElementsInRect(layers, next));
      return;
    }
    if (!drag) return;
    // 回転は drag.scale ではなく中心とポインタの角度で決まるので、scale 防御の前に処理する（#279）。
    if (drag.mode === "rotate") {
      e.preventDefault();
      const center = { x: drag.start.x + drag.start.w / 2, y: drag.start.y + drag.start.h / 2 };
      const deg = rotationFromPointer(center, toCanvas(e.clientX, e.clientY));
      onRotate(drag.id, e.shiftKey ? snapAngle(deg, 15) : deg);
      return;
    }
    if (drag.scale <= 0) return;
    e.preventDefault();
    const dx = (e.clientX - drag.startClientX) / drag.scale;
    const dy = (e.clientY - drag.startClientY) / drag.scale;
    if (drag.mode === "move") {
      // 移動＝純粋 moveFreeElement、さらに他レイヤーへ吸着（純粋 snapToTargets）。差分を選択全体へ適用＝一括移動。
      const moved = moveFreeElement(drag.start, dx, dy, 0);
      const snap = snapToTargets(
        { x: moved.x, y: moved.y, w: drag.start.w, h: drag.start.h },
        drag.otherEdges,
        SNAP_THRESHOLD_PX / drag.scale,
      );
      const ddx = snap.x - drag.start.x;
      const ddy = snap.y - drag.start.y;
      // starts は beginDrag で常に設定（型も必須）。万一 layers に無い id 混入で空配列になっても主だけは動かす。
      const startsList = drag.starts.length > 0 ? drag.starts : [{ id: drag.id, x: drag.start.x, y: drag.start.y }];
      onMoveMany(startsList.map((s) => ({ id: s.id, x: s.x + ddx, y: s.y + ddy })));
      setGuides({ x: snap.guideX, y: snap.guideY });
    } else if (drag.corner) {
      // リサイズ＝純粋 ops（Shift で縦横比維持）。主のみ。回転ありは対角を canvas 固定する回転考慮版（#279）。基準角は開始時に固定。
      const rot = drag.rotation ?? 0;
      onChange(
        drag.id,
        rot === 0
          ? resizeFreeElement(drag.start, drag.corner, dx, dy, GEOM_MIN_SIZE, 0, e.shiftKey)
          : resizeRotatedFreeElement(drag.start, drag.corner, dx, dy, rot, GEOM_MIN_SIZE, 0, e.shiftKey),
      );
    }
  };

  const endDrag = (e: ReactPointerEvent) => {
    if (marquee) {
      setMarquee(null);
      try { ref.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      return;
    }
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
      // 何もない所を押したら選択解除＋範囲選択（マーキー）を開始（レイヤー/ハンドルの onPointerDown は stopPropagation 済み）。
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        onSelect(null);
        if (e.button !== 0) return;
        const p = toCanvas(e.clientX, e.clientY);
        try { ref.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
        setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
    >
      {[...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)).map((l) => {
        const selected = selectedIds.includes(l.id);
        const isPrimary = l.id === primaryId;
        const rotated = (l.rotation ?? 0) !== 0; // 回転あり＝中心軸で回す（出力 SVG の rotate と一致）
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
              transform: rotated ? `rotate(${l.rotation}deg)` : undefined,
            }}
          >
            <span style={{ position: "absolute", top: 0, left: 0, fontSize: 11, background: "rgba(0,0,0,0.55)", color: "#fff", padding: "0 4px", borderRadius: 2, pointerEvents: "none", whiteSpace: "nowrap" }}>
              {label(l)}
            </span>
            {isPrimary &&
              HANDLES.map((hd) => (
                <div
                  key={hd.corner}
                  onPointerDown={(e) => beginDrag(e, l, "resize", hd.corner)}
                  style={{ position: "absolute", left: hd.left, top: hd.top, width: 12, height: 12, transform: "translate(-50%, -50%)", background: "#fff", border: "2px solid var(--color-primary)", borderRadius: 2, cursor: rotated ? resizeCursor(hd.corner, l.rotation ?? 0) : hd.cursor }}
                />
              ))}
            {/* 回転ハンドル（#279 同様）：単一の主に出す。回転中も操作できるよう rotated 条件は付けない。 */}
            {isPrimary && (
              <>
                <div style={{ position: "absolute", left: "50%", top: -22, width: 1, height: 22, background: "var(--color-primary)", transform: "translateX(-50%)", pointerEvents: "none" }} />
                <div
                  data-testid="tmpl-rotate-handle"
                  onPointerDown={(e) => beginRotate(e, l)}
                  title="ドラッグで回転（Shift で15°ずつ）"
                  style={{ position: "absolute", left: "50%", top: -22, width: 12, height: 12, transform: "translate(-50%, -50%)", background: "#fff", border: "2px solid var(--color-primary)", borderRadius: "50%", cursor: "grab" }}
                />
              </>
            )}
          </div>
        );
      })}

      {/* 範囲選択（マーキー）の矩形（ドラッグ中のみ・canvas 座標→%）。 */}
      {marquee && (
        <div
          data-testid="tmpl-marquee"
          style={{
            position: "absolute",
            left: `${(Math.min(marquee.x0, marquee.x1) / canvasW) * 100}%`,
            top: `${(Math.min(marquee.y0, marquee.y1) / canvasH) * 100}%`,
            width: `${(Math.abs(marquee.x1 - marquee.x0) / canvasW) * 100}%`,
            height: `${(Math.abs(marquee.y1 - marquee.y0) / canvasH) * 100}%`,
            border: "1px dashed var(--color-primary)",
            background: "rgba(80,130,255,0.10)",
            pointerEvents: "none",
            zIndex: 35,
          }}
        />
      )}

      {guides.x != null && (
        <div data-testid="tmpl-snap-guide-x" style={{ position: "absolute", left: `${(guides.x / canvasW) * 100}%`, top: 0, bottom: 0, width: 1, background: SNAP_GUIDE_COLOR, pointerEvents: "none", zIndex: 40 }} />
      )}
      {guides.y != null && (
        <div data-testid="tmpl-snap-guide-y" style={{ position: "absolute", top: `${(guides.y / canvasH) * 100}%`, left: 0, right: 0, height: 1, background: SNAP_GUIDE_COLOR, pointerEvents: "none", zIndex: 40 }} />
      )}
    </div>
  );
}
