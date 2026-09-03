// 画面ぜんぶで共有する「キー操作を奪ってよいか」の判定（#701・監査 §7-6）。
//
// **同じ規則を画面ごとに書き分けない**（§6）。取り消し/やり直し（`useUndoRedoShortcuts`）と、
// タイムライン編集の選択操作（`Escape`／`Ctrl+A`）が同じ入口を通る。

/**
 * **文字を打つ入力**の種類（#701 レビュー）。`<input>` は種類で意味が全く違う＝スライダー（`range`）や
 * チェックボックスは「文字を打つ場所」ではないので、そこにフォーカスがあるだけでキー操作が
 * **黙って効かなくなる**のを避ける（再生位置のスライダーを触った直後に `Escape` が死ぬ、が実際に起きる）。
 * 種類が空／未知のときは `type` の既定＝`text` なので、打てる側に倒す（安全側）。
 */
const NON_TEXT_INPUT_TYPES = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "file", "image", "color"]);

/**
 * 文字入力中の要素か（input/textarea/contentEditable）。
 * 「標準の文字 Undo を奪わない」判定と、履歴グループの「連続入力だけを1履歴に合成する」判定に使う。
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (!t) return false;
  if (t.tagName === "TEXTAREA") return true;
  if (t.tagName === "INPUT") return !NON_TEXT_INPUT_TYPES.has(((t as HTMLInputElement).type || "text").toLowerCase());
  // `isContentEditable` は要素以外（や欠けている相手）では `undefined` になりうるので、真偽値に落として返す
  // ＝呼び出し側が `boolean` として扱えることを型どおり保証する。
  return t.isContentEditable === true;
}

/**
 * **日本語を変換している最中か**。変換中の `Escape` は「変換をやめる」、`Enter` は「確定する」であって、
 * アプリの操作ではない。ここで止めないと、打っている文が**消えたり確定できなかったり**する。
 *
 * `isComposing` は変換中に `true` になるが、**古い WebView では付かないことがある**ので、
 * その場合の目印（`keyCode === 229`＝変換中のキーは一律この値になる）も一緒に見る。
 */
export function isImeComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}

/**
 * **`Space` を押すと、それ自身が反応する要素**か（#721）。ボタン・セレクト・チェックの類。
 *
 * `Space` を「再生／停止」に使う画面では、これを見ないと**押した要素と再生の両方が動く**
 * （「消す」ボタンにフォーカスしたまま `Space` を押すと、消えたうえに再生が始まる）。
 * かといって一律で `preventDefault` すると、**画面じゅうのボタンがキーボードで押せなくなる**。
 * ＝奪ってよいのは「`Space` に意味を持たない場所」だけ。
 *
 * 文字入力は `isTextEntryTarget` の担当（そちらが先に弾く）ので、ここでは見ない。
 */
const SPACE_ACTIVATED_INPUT_TYPES = new Set(["button", "submit", "reset", "checkbox", "radio", "file"]);
const SPACE_ACTIVATED_ROLES = new Set(["button", "checkbox", "radio", "switch", "menuitem", "option", "tab"]);

export function activatesOnSpace(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (!t || typeof t.tagName !== "string") return false;
  if (t.tagName === "BUTTON" || t.tagName === "SELECT" || t.tagName === "SUMMARY") return true;
  if (t.tagName === "INPUT") return SPACE_ACTIVATED_INPUT_TYPES.has(((t as HTMLInputElement).type || "text").toLowerCase());
  // 素の要素に役割だけ付けたもの（`role="button"` ＋ `tabindex`）も、押せば反応する＝同じ扱い。
  const role = t.getAttribute?.("role");
  return role != null && SPACE_ACTIVATED_ROLES.has(role);
}

/**
 * **矢印キーを押すと、それ自身が反応する要素**か（#721 レビュー）。
 *
 * `Space` を譲るのに矢印を無条件で奪うと、**同じ理由の判断が入口で割れる**（ADR-0026②）。
 * 閉じた `<select>` の ←/→ は選択肢を変える・スライダーは値を動かす・ラジオは選択を移すので、
 * ここで譲らないと**フォーカスした欄の値が変わらず再生位置だけ動く**。
 *
 * 文字入力は `isTextEntryTarget` の担当（そちらが先に弾く）。
 */
const ARROW_INPUT_TYPES = new Set(["range", "radio", "number", "date", "time", "month", "week", "datetime-local"]);
const ARROW_ROLES = new Set(["slider", "spinbutton", "radio", "listbox", "option", "menu", "menuitem", "tab", "tablist", "tree", "treeitem", "combobox"]);

export function usesArrowKeys(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (!t || typeof t.tagName !== "string") return false;
  if (t.tagName === "SELECT") return true;
  if (t.tagName === "INPUT") return ARROW_INPUT_TYPES.has(((t as HTMLInputElement).type || "text").toLowerCase());
  const role = t.getAttribute?.("role");
  return role != null && ARROW_ROLES.has(role);
}

/**
 * 日本語を打っている最中か（React の合成イベント版）。
 *
 * ⚠️ **`isImeComposing` と別に要る**＝あちらは窓の購読（`KeyboardEvent`）用で、
 * 欄の `onKeyDown` に来るのは React の合成イベント（`nativeEvent` の中に本物がいる）。
 */
export function isComposingReact(e: { nativeEvent: { isComposing?: boolean; keyCode?: number } }): boolean {
  return !!e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;
}

/**
 * **名前を打ち替える欄**のキー（`Enter` で決める・`Escape` でやめる）。#989
 *
 * ⚠️ **変換中は奪わない**＝変換中の `Enter` は「変換を確定する」、`Escape` は「変換をやめる」。
 * 奪うと**変換前の文字のまま欄が閉じる**（実害がはっきりしている）。
 *
 * ⚠️ **1か所に置く**＝同じ形が画面のあちこちに手書きされていて、**4か所で抜けていた**
 *（グループ名・自由配置の要素名・見た目パターンの文字欄・動画の名前）。
 * 写して増やすと、次に足す欄でも同じように抜ける。
 */
export function renameFieldKeys(handlers: { commit?: () => void; cancel?: () => void }) {
  return (e: { key: string; nativeEvent: { isComposing?: boolean; keyCode?: number } }): void => {
    if (isComposingReact(e)) return;
    if (e.key === "Enter") handlers.commit?.();
    else if (e.key === "Escape") handlers.cancel?.();
  };
}

/**
 * このキー操作を**アプリが横取りしてはいけない**か（文字を打っている最中＝入力欄／日本語の変換中）。
 * 画面のキー操作はまずこれを通す。
 */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  return isTextEntryTarget(e.target) || isImeComposing(e);
}

/**
 * 矢印キーの連打を**1回の取り消し**へ畳むときの、手が止まったとみなす間合い（ミリ秒）。
 *
 * ⚠️ **画面ごとに持たない**（#788 レビュー）＝タイムライン編集と見た目パターン編集で間合いが違うと、
 * 「押しっぱなしのあと何回戻るか」が画面で変わる（ADR-0026②）。決定20＝押し続けても取り消しは1回ぶん。
 */
export const NUDGE_GROUP_IDLE_MS = 600;
