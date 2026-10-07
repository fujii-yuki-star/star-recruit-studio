// `Space` を「再生／停止」に使う画面で、**焦点のあるボタンへ `Space` を譲るか**を決める（UI/UX 監査 2026-10-02）。
//
// ⚠️ **マウスで押したボタンには譲らない**＝「複製」「列を足す」などを押してから `Space` で再生しようとすると、
//   もう1つ複製される・列がもう1本増えていた（動画編集の型では `Space` は再生と停止だけ）。
// ⚠️ **キーボードでたどり着いたボタンには譲る**＝`Tab` で移ってきたボタンは `Space` で押せる（キーボードの道を壊さない）。
// ⚠️ **見分けは「焦点が来たとき、直前の入力がキーだったか」**＝押した相手を覚える形（PR4a の初版）だと、確認や
//   メニューを閉じて**焦点が開いたボタンへ戻る**（`useFocusTrap`）と「キーボードで来た」扱いになり、マウスで閉じた
//   のに `Space` で確認が開き直していた（PR4a レビュー 🟡）。焦点を戻すのは入力ではないので、直前の入力で見る。
// ⚠️ 焦点を外す（blur）案は採らない（#950）＝外し方を誤るとキーボードでボタンが押せなくなる。
// ⚠️ **画面ごとに書かない**＝タイムライン編集と仕上がり確認が同じ判定を使う（同じキーの意味を画面で割らない・ADR-0026②）。
import { useEffect } from "react";
import { activatesOnSpace } from "./keyboardShortcut";

/** 押して反応する「ボタンの類」。選ぶ欄（`select`）やチェックは含めない＝そこでの `Space` は選ぶ・切り替える操作。 */
const BUTTON_LIKE = "button, [role='button'], [role='switch'], summary";

/** 直前の入力がキーだったか。⚠️ 既定は「キー」＝まだ何も押していないときに置かれた焦点は、これまでどおり譲る。 */
let lastInputWasKey = true;
/**
 * **マウスの後に焦点が来た要素**（マウスで押した・マウスで閉じて焦点が戻った）。ここだけ譲らない。
 * ⚠️ 「キーボードで来た要素」を覚える形にしない＝焦点の来方が分からない要素（覚えが無い）まで譲らなくなり、
 *   キーボードの道を壊す側へ倒れる。分からないときは**これまでどおり譲る**。
 */
let mouseFocused: Element | null = null;
let installs = 0;

const onKeyDown = (): void => { lastInputWasKey = true; };
const onPointerDown = (e: PointerEvent): void => {
  lastInputWasKey = false;
  // ⚠️ **既に焦点のあるボタンをマウスで押した**ときは焦点が動かず `focusin` が来ない＝ここで覚える
  //（Tab で来たボタンをマウスで押し直したら、それはマウスで押したボタン）。
  const t = e.target instanceof Element ? e.target.closest(BUTTON_LIKE) : null;
  if (t && t === document.activeElement) mouseFocused = t;
};
const onFocusIn = (e: FocusEvent): void => {
  mouseFocused = !lastInputWasKey && e.target instanceof Element ? e.target : null;
};

/** 見張りを張る（画面が開いている間だけ・何画面で呼んでも1組）。 */
export function useSpaceFocusTracking(): void {
  useEffect(() => {
    if (installs++ === 0) {
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("pointerdown", onPointerDown, true);
      window.addEventListener("focusin", onFocusIn, true);
    }
    return () => {
      if (--installs === 0) {
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("pointerdown", onPointerDown, true);
        window.removeEventListener("focusin", onFocusIn, true);
      }
    };
  }, []);
}

/**
 * `Space` を押した相手（`target`）に譲るか。譲らないなら呼び出し側が再生／停止にする。
 * - `Space` で反応しない要素 → 譲らない
 * - ボタンの類でない（選ぶ欄・チェック等） → 譲る
 * - ボタンの類 → **マウスの後に焦点が来たものだけ**譲らない（マウスで押した・マウスで閉じて焦点が戻った）
 */
export function yieldsSpaceTo(target: EventTarget | null): boolean {
  if (!activatesOnSpace(target)) return false;
  const el = target as Element;
  if (typeof el.matches !== "function" || !el.matches(BUTTON_LIKE)) return true;
  return el !== mouseFocused;
}

/** 検査用：覚えを初めに戻す。 */
export function resetSpaceFocusForTest(): void {
  lastInputWasKey = true;
  mouseFocused = null;
}
