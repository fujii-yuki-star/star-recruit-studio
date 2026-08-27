// 安全領域（セーフエリア）の枠（#265）。純粋な部分（§7 テスト対象）。
//
// ⚠️ **編集を助けるためだけのもの**＝**書き出しには焼かない**（Issue の受け入れ条件）。
// 動画の中身ではないので `project.json` にも入れない（見るか見ないかは画面の好み）。
import { ORIENTATION, type Orientation } from '../enums';

/**
 * 端から空けておく割合（#265）。
 *
 * ⚠️ **横と縦で違う**＝配信・SNS で切られやすい辺が違う。横型（16:9）はテレビの
 * オーバースキャン由来で**四辺 5%** が慣例。縦型（9:16）は上下に UI（時刻・操作ボタン）が
 * 重なるので**上下を厚く**する（左右は切られにくい）。
 * ⚠️ **値の出どころを1か所に**（§2-7）＝画面と判定（はみ出しの注意）が同じ数字を見る。
 */
export const SAFE_AREA_INSET = {
  [ORIENTATION.landscape]: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
  [ORIENTATION.portrait]: { top: 0.08, right: 0.04, bottom: 0.12, left: 0.04 },
} as const;

export type SafeAreaRect = { x: number; y: number; w: number; h: number };

/**
 * 安全領域の矩形（キャンバスの座標）。
 *
 * ⚠️ **割合で持つ**＝`canvas` の大きさが変わっても（将来の 1:1 や解像度違い）同じ見え方になる。
 */
export function safeAreaRect(canvas: { width: number; height: number }, orientation: Orientation): SafeAreaRect {
  const inset = SAFE_AREA_INSET[orientation] ?? SAFE_AREA_INSET[ORIENTATION.landscape];
  const x = canvas.width * inset.left;
  const y = canvas.height * inset.top;
  return {
    x,
    y,
    w: Math.max(0, canvas.width - x - canvas.width * inset.right),
    h: Math.max(0, canvas.height - y - canvas.height * inset.bottom),
  };
}

/**
 * その矩形が安全領域から**はみ出しているか**（#265・任意の注意）。
 *
 * ⚠️ **「画面の外」とは別**＝`subtitleOverflowsCanvas` は画面から出るもの、こちらは
 * **画面の中だが端に寄りすぎ**ているもの。切られる媒体でだけ問題になるので**注意止まり**。
 */
export function outsideSafeArea(
  item: { x: number; y: number; w: number; h: number },
  safe: SafeAreaRect,
): boolean {
  return item.x < safe.x || item.y < safe.y
    || item.x + item.w > safe.x + safe.w
    || item.y + item.h > safe.y + safe.h;
}
