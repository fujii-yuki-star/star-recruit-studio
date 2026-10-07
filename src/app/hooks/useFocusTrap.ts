// 開いている間だけ**焦点をその中に閉じ込め、閉じたら元へ戻す**（#986）。
//
// ⚠️ **入る方向だけ塞いで、出る方向が残っていた**＝削除の確認は出た瞬間に「やめる」へ手を移すのに
// （#354）、**閉じるときに元へ戻していなかった**ので、押した瞬間に焦点が `body` へ落ちる＝
// #354 が直そうとした症状（「押した直後にどこにいるか分からなくなり、Tab で画面の頭から辿り直す」）
// が、出る方向にそのまま残っていた。
//
// ⚠️ **色を選ぶ面は、そもそも中へ入れなかった**＝`createPortal(..., document.body)` で
// **body の末尾**へ出すので、開いても手はトリガーに残り、`Tab` は**面ではなく画面の続き**へ進む。
// 色を変える唯一の入口なので、キーボードだけの人は**実質どの色も変えられなかった**。
//
// ⚠️ **1か所に置く**＝部品ごとに書くと、3つのうち1つだけ直る（このリポジトリで繰り返している型）。
import { useEffect, type RefObject } from "react";

/** 焦点を当てられる要素（`Tab` で回るもの）。 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ⚠️ **見え方で絞らない**＝`offsetParent` を見る形にしたが、**jsdom には配置が無く常に `null`**で、
// 検査が「1つも拾えない」まま緑にならなかった（実装が正しくても確かめられない＝門番の意味が無い）。
// ブラウザは `display:none` の要素に手を当てても何も起きないので、絞らなくても実害は出ない。
// ⚠️ **開いている間の中身は全部見えている**部品にだけ使う、が前提（面・メニュー・確認）。
const focusablesIn = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];

/**
 * `active` の間だけ、`ref` の中に焦点を閉じ込める。
 *
 * - 開いたとき＝`initial`（無ければ中の最初のもの）へ手を移す
 * - `Tab` / `Shift+Tab`＝**外へ出さず**、端で反対側へ回す
 * - 閉じたとき＝**開く前に手があった所へ戻す**
 *
 * ⚠️ **`Escape` は扱わない**＝それは名簿（`escapeOwners`）の仕事。ここは焦点だけ。
 */
export function useFocusTrap(
  active: boolean,
  ref: RefObject<HTMLElement | null>,
  initial?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return;
    // ⚠️ **開く前の手を控える**＝閉じたときに戻す先。控えないと `body` へ落ちる。
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = ref.current;
    // 中の最初のものへ手を移す（既に中にいるなら動かさない＝打っている途中を奪わない）。
    const first = initial?.current ?? (box ? focusablesIn(box)[0] : null);
    if (box && !box.contains(document.activeElement)) first?.focus();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Tab") return;
      const root = ref.current;
      if (!root) return;
      const items = focusablesIn(root);
      if (items.length === 0) return;
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      const at = document.activeElement;
      // ⚠️ **外にいるときは中へ引き戻す**＝ポータルで body の末尾へ出す面は、
      // そのままだと `Tab` が**面ではなく画面の続き**へ進む。
      if (!root.contains(at)) {
        e.preventDefault();
        (e.shiftKey ? tail : head).focus();
        return;
      }
      if (e.shiftKey && at === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && at === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      // ⚠️ **元へ戻す**＝押した瞬間に消えるボタンから手が落ちる（#354 の症状の裏側）。
      // ⚠️ **まだ画面にあるときだけ**＝消えた要素へ戻そうとしても何も起きない。
      if (returnTo && returnTo.isConnected) returnTo.focus();
    };
  }, [active, ref, initial]);
}
