// 素材を**プレビューの差し込み口へ落とす**ときの落とし先（#1030 ②）。
//
// ⚠️ **押す道と同じ相手にする**（PR #1042 レビュー 🔴）＝最初は `layoutScene` の
// `role:'slot'` だけを見ており、**背景層とロゴ層が落とし先から抜けていた**。実際の見た目
// パターンには **`slot` 型の層を1つも持たず、写真を受けるのは `background` だけ**のものがあり
//（`opening_yuko_right_v1`）、そこでは**押せば入るのに、掴んで落とすと枠が1つも出ない**。
// 「押す道とドラッグで入る所が違う」は、この Issue（#1030）が直そうとしている型そのもの。
//
// ⚠️ **枠の場所は描く側から採る**＝`layoutScene` が返した箱をそのまま使う（テンプレの層の
// 座標を直接読むと、グループ変形〔ADR-0022〕が掛かった見た目でずれる）。
// ⚠️ **描かれないものは層の箱で補う**＝空の**ロゴ**層は `layoutScene` が**何も置かない**ので
// 箱が取れない。取れないからといって落とし先から外すと、上と同じ「押せるのに落とせない」になる。
import { isAssignableToLayer } from "../../domain/template/slotAssign";
import type { Asset } from "../../domain/project/types";
import type { Layer } from "../../domain/template/types";
import type { SceneLayout } from "../../renderer/layout";

/** 落とせる差し込み口ひとつ分。 */
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
 * **その素材を落とせる差し込み口**を並べる（純粋）。
 *
 * ⚠️ **入れられる口だけを出す**＝入らない口の枠を出すと「落とせそうに見えて何も起きない」。
 * 判定は押す道と**同じ関数**（`isAssignableToLayer`）＝片方でだけ入る素材を作らない。
 */
export function slotDropTargets(
  layout: SceneLayout,
  layers: readonly Layer[],
  assetRefs: Readonly<Record<string, string | null | undefined>>,
  asset: Asset,
): SlotDropTarget[] {
  const boxById = new Map(layout.items.map((i) => [i.id, i]));
  const out: SlotDropTarget[] = [];
  for (const layer of layers) {
    if (!isAssignableToLayer(asset, layer)) continue;
    const drawn = boxById.get(layer.id);
    const box = drawn ?? layer; // 描かれない（空のロゴ）ときは層の箱で補う
    out.push({
      layerId: layer.id,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      assetId: assetRefs[layer.id] ?? null,
    });
  }
  return out;
}
