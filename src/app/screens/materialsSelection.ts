import type { Asset } from "../../domain/project/types";

/**
 * 素材画面の右パネルに出す素材を「いま表示中（フィルタ適用後）の一覧」の中から選ぶ（#413）。
 * 選択中 ID が表示中にあればそれ、無ければ表示中の先頭。表示中が 0 件なら undefined を返す
 * ＝別フィルタの素材を出さない（フィルタで 0 件のとき右パネルに無関係な素材が出る不具合の解消）。
 */
export function pickPanelAsset(visible: Asset[], selectedId: string): Asset | undefined {
  return visible.find((a) => a.assetId === selectedId) ?? visible[0];
}
