// 素材を**プレビューの差し込み口へ落とす**ときの目印（#1030 ②）。
//
// ⚠️ **枠は描く側と同じ場所に置く**＝`layoutScene` が返した `role:'slot'` の箱をそのまま使う
// （テンプレの層の座標を自分で読むと、グループ変形〔ADR-0022〕が掛かった見た目でずれる）。
// ⚠️ **`ScenePreview` の子として置く**＝あちらの「fit 箱」は canvas と同比なので、
// **割合（%）で置けば縮尺を自分で持たなくてよい**。
import type { SlotDropTarget } from "./slotDropTargets";

/** 落とし先の目印。`hovered` の口だけ強く見せる（どこへ入るかを押さえたまま分かるように）。 */
export function SlotDropOverlay({
  targets,
  canvas,
  hoveredLayerId,
  labelOf,
}: {
  targets: readonly SlotDropTarget[];
  canvas: { width: number; height: number };
  hoveredLayerId: string | null;
  /** 差し込み口の呼び名（場面編集の「使用素材」と同じ名前を渡す＝画面内で別の名にしない）。 */
  labelOf: (layerId: string) => string;
}) {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
      {targets.map((t) => {
        const on = t.layerId === hoveredLayerId;
        return (
          <div
            key={t.layerId}
            data-slot-drop={t.layerId}
            style={{
              position: "absolute",
              left: `${(t.x / canvas.width) * 100}%`,
              top: `${(t.y / canvas.height) * 100}%`,
              width: `${(t.w / canvas.width) * 100}%`,
              height: `${(t.h / canvas.height) * 100}%`,
              // ⚠️ **落とす前から「ここへ入る」が分かる**＝押さえたまま指を動かしている間に見える
              //   （離してから初めて分かる、を作らない）。
              border: on ? "3px solid var(--color-primary)" : "2px dashed var(--color-border)",
              background: on ? "rgba(0, 0, 0, 0.12)" : "rgba(0, 0, 0, 0.04)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
            }}
          >
            <span
              className="text-sm"
              style={{
                background: "var(--color-surface)",
                padding: "2px 6px",
                borderRadius: "var(--radius)",
                opacity: on ? 1 : 0.75,
              }}
            >
              {labelOf(t.layerId)}
              {t.assetId ? "（入れ替え）" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
