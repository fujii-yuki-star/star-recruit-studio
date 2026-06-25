import { useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { FreeElement } from "../../domain/project/types";
import { FREE_ELEMENT_KIND } from "../../domain/enums";
import { FREE_MIN_SIZE, moveFreeElement, resizeFreeElement, type ResizeCorner } from "../../domain/project/freeLayoutOps";

// 仕上がり確認（ScenePreview）に重ねる自由配置の操作レイヤ（Phase 4b / 直接編集 #174）。
// ScenePreview は width:100% / aspect-ratio をテンプレ canvas（向き）に合わせて SVG を充填するため
// レターボックスが無く、要素の矩形は %（canvasW/canvasH 基準）でプレビューに正確に重なる。
// ドラッグ/リサイズはルートで pointer capture し、マウス座標 px をドラッグ開始時の縮尺で canvas 座標へ換算する。
// 右クリックで操作メニュー、テキストはダブルクリックでインライン編集できる（#174）。

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

// 右クリックメニューの推定サイズ（画面端からはみ出さないようクランプするため）。
const MENU_W = 160;
const MENU_H = 220;

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
  /** 右クリックメニューの操作（いずれも対象 id を渡す）。 */
  onDuplicate: (id: string) => void;
  onBringToFront: (id: string) => void;
  onSendToBack: (id: string) => void;
  onDelete: (id: string) => void;
  /** テキストのインライン編集の確定（patch 相当）。 */
  onChangeText: (id: string, text: string) => void;
}

export function FreeLayoutOverlay({
  freeLayout, canvasW, canvasH, selectedId, onSelect, onChange, gridSize = 0,
  onDuplicate, onBringToFront, onSendToBack, onDelete, onChangeText,
}: OverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // 右クリックメニュー（対象 id とビューポート座標）。
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // インライン編集中のテキスト要素 id。
  const [editingId, setEditingId] = useState<string | null>(null);

  // ルートで pointer capture することで、要素/ハンドルの押下後はドラッグがプレビュー外に出ても追従する。
  const beginDrag = (
    e: ReactPointerEvent, el: FreeElement, mode: "move" | "resize", corner?: ResizeCorner,
  ) => {
    if (e.button !== 0) return; // 左ボタンのみドラッグ（右クリックはメニュー・中クリックは無視）
    e.preventDefault();
    e.stopPropagation(); // 角ハンドルのドラッグが本体の移動を兼ねないように
    setMenu(null);
    setEditingId(null); // ドラッグ開始でインライン編集を抜ける
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

  // 右クリック：対象を選択しカーソル位置にメニューを開く（画面端でクランプ）。
  const openMenu = (e: ReactMouseEvent, el: FreeElement) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingId(null);
    onSelect(el.id);
    const x = Math.max(0, Math.min(e.clientX, window.innerWidth - MENU_W));
    const y = Math.max(0, Math.min(e.clientY, window.innerHeight - MENU_H));
    setMenu({ id: el.id, x, y });
  };

  const menuEl = menu ? freeLayout.find((e) => e.id === menu.id) ?? null : null;
  // メニュー項目（「編集」はテキスト→インライン編集、それ以外→選択。他は #172 のハンドラ）。
  const menuItems: { label: string; danger?: boolean; run: (id: string) => void }[] = menuEl
    ? [
        {
          label: "編集",
          run: (id) =>
            menuEl.kind === FREE_ELEMENT_KIND.text ? setEditingId(id) : onSelect(id),
        },
        { label: "複製", run: onDuplicate },
        { label: "前面", run: onBringToFront },
        { label: "背面", run: onSendToBack },
        { label: "削除", danger: true, run: onDelete },
      ]
    : [];

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
      // 何もない所を押したら選択解除＋編集/メニューを閉じる（要素/ハンドルの onPointerDown は stopPropagation 済み）。
      onPointerDown={(e) => { if (e.target === e.currentTarget) { onSelect(null); setEditingId(null); setMenu(null); } }}
      // 空白部分の右クリックはブラウザ既定メニューだけ抑止する。
      onContextMenu={(e) => { e.preventDefault(); }}
    >
      {freeLayout.map((el) => {
        const selected = el.id === selectedId;
        const editing = el.id === editingId && el.kind === FREE_ELEMENT_KIND.text;
        return (
          <div
            key={el.id}
            onPointerDown={(e) => beginDrag(e, el, "move")}
            onContextMenu={(e) => openMenu(e, el)}
            onDoubleClick={(e) => {
              if (el.kind !== FREE_ELEMENT_KIND.text) return;
              e.preventDefault();
              e.stopPropagation();
              setMenu(null);
              onSelect(el.id);
              setEditingId(el.id);
            }}
            style={{
              position: "absolute",
              left: `${(el.x / canvasW) * 100}%`,
              top: `${(el.y / canvasH) * 100}%`,
              width: `${(el.w / canvasW) * 100}%`,
              height: `${(el.h / canvasH) * 100}%`,
              boxSizing: "border-box",
              border: selected ? "2px solid var(--color-primary)" : "1px dashed rgba(0,0,0,0.4)",
              background: selected ? "rgba(80,130,255,0.08)" : "transparent",
              cursor: editing ? "text" : "move",
            }}
          >
            {editing ? (
              <textarea
                autoFocus
                value={el.text ?? ""}
                onChange={(e) => onChangeText(el.id, e.target.value)}
                onPointerDown={(e) => e.stopPropagation()} // textarea 内の操作でドラッグを始めない
                onDoubleClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.stopPropagation()} // 編集中はブラウザ標準の右クリックを使う
                onBlur={() => setEditingId(null)}
                onKeyDown={(e) => {
                  // Enter（Shift 無し）/Esc で確定して抜ける。改行は Shift+Enter。
                  if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
                    e.preventDefault();
                    setEditingId(null);
                  }
                }}
                style={{
                  width: "100%", height: "100%", boxSizing: "border-box", resize: "none",
                  border: "none", outline: "none", padding: 4, margin: 0,
                  background: "#fff", color: "#222", fontSize: 16, lineHeight: 1.3,
                }}
              />
            ) : (
              selected &&
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
              ))
            )}
          </div>
        );
      })}

      {menu && menuEl && (
        <>
          {/* 外側のクリック/右クリックで閉じる透明バックドロップ。 */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 50 }}
            onPointerDown={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
          />
          <div
            role="menu"
            style={{
              position: "fixed", left: menu.x, top: menu.y, zIndex: 51,
              background: "#fff", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 8,
              boxShadow: "0 6px 24px rgba(0,0,0,0.18)", padding: 4, minWidth: 140,
            }}
          >
            {menuItems.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                className="btn btn-ghost text-sm"
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  color: it.danger ? "var(--color-danger)" : undefined,
                }}
                onClick={() => { it.run(menu.id); setMenu(null); }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
