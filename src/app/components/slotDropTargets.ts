// 素材を**プレビューの差し込み口へ落とす**ための受け口（#1030 ②）。
//
// ⚠️ **押す道はもう在る**（#1030 ①）＝これは**二重導線**の片方（ADR-0034 決定2＝
// 「ボタンで置く道は残したまま、運んで落とす道を足す」）。**ドラッグでしかできない操作は作らない**。
//
// ⚠️ **枠は描く側と同じ場所に置く**＝`layoutScene` が返した `role:'slot'` の箱をそのまま使う
// （テンプレの層の座標を自分で読むと、グループ変形〔ADR-0022〕が掛かった見た目でずれる）。
//
// ⚠️ **`ScenePreview` の子として置く**＝あちらの「fit 箱」は canvas と同比なので、
// **割合（%）で置けば縮尺を自分で持たなくてよい**（`FreeLayoutOverlay` が実寸で持っているのは
// 掴んで動かすため。こちらは当たり判定だけなので割合で足りる）。
import type { SceneLayout } from "../../renderer/layout";

/** 落とせる差し込み口ひとつ分（描く側の箱をそのまま持つ）。 */
export interface SlotDropTarget {
  layerId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** いま入っている素材（`null`＝空）。落としたときに入れ替わるかの判断に使う。 */
  assetId: string | null;
}

/**
 * 描く側の並びから、**落とせる差し込み口**を取り出す（純粋）。
 *
 * ⚠️ **`role` で選ぶ**＝`background`（塗りになる）・`logo`（何も置かれない）・文字は対象外。
 * 押す道（`slotForAsset`）と同じく「素材の差し込み口」だけを相手にする。
 */
export function slotDropTargets(layout: SceneLayout): SlotDropTarget[] {
  const out: SlotDropTarget[] = [];
  for (const i of layout.items) {
    if (i.kind !== "image" || i.role !== "slot") continue;
    out.push({ layerId: i.id, x: i.x, y: i.y, w: i.w, h: i.h, assetId: i.assetId });
  }
  return out;
}

