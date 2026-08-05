// `Escape` を**いま自分で受け持っているもの**の名簿（#701 レビュー）。
//
// `Escape` は「いちばん手前のものを1段はがす」キー。ところが受け手（メニュー・ドラッグの中止・確認）は
// それぞれ独立に `window` を購読していて、**同時に発火する**。画面側が「開いているもの」を手で数える形にすると、
// 受け手が増えるたびに数え漏れて**同じ穴が開き続ける**（実際に、欄のドラッグ中止と欄のメニューを数え漏らした）。
//
// そこで**受け持っている側が名乗る**形にする。画面は「誰か名乗っているか」だけを見て、名乗り手がいる間は
// 自分の `Escape`（＝いちばん外側の後始末）を実行しない。新しい受け手は名乗るだけで自動的に順番へ入る。
import { useEffect } from "react";

/** いま名乗っている数（0＝誰も受け持っていない）。 */
let owners = 0;

/** `Escape` を受け持っているものがあるか。**いちばん外側の後始末をする側**が見る。 */
export function hasEscapeOwner(): boolean {
  return owners > 0;
}

/**
 * `Escape` を受け持っている間だけ名乗る（`active` が true の間）。
 * **自分で `Escape` を処理する部品はこれを呼ぶ**（メニュー・ドラッグ中の中止・答えを求める確認など）。
 */
export function useEscapeOwner(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    owners += 1;
    return () => { owners -= 1; };
  }, [active]);
}

/**
 * 部品ではない場所（イベント購読の中など）から名乗るとき用。**返ってくる関数を必ず呼ぶ**
 * （呼ばないと名乗ったままになり、`Escape` が永久に効かなくなる）。
 */
export function claimEscape(): () => void {
  owners += 1;
  let released = false;
  return () => {
    if (released) return; // 二重に外しても数がずれない
    released = true;
    owners -= 1;
  };
}
