// 画面ぜんぶで共有する「キー操作を奪ってよいか」の判定（#701・監査 §7-6）。
//
// **同じ規則を画面ごとに書き分けない**（§6）。取り消し/やり直し（`useUndoRedoShortcuts`）と、
// タイムライン編集の選択操作（`Escape`／`Ctrl+A`）が同じ入口を通る。

/**
 * 文字入力中の要素か（input/textarea/contentEditable）。
 * 「標準の文字 Undo を奪わない」判定と、履歴グループの「連続入力だけを1履歴に合成する」判定に使う。
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  // `isContentEditable` は要素以外（や欠けている相手）では `undefined` になりうるので、真偽値に落として返す
  // ＝呼び出し側が `boolean` として扱えることを型どおり保証する。
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable === true);
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
 * このキー操作を**アプリが横取りしてはいけない**か（文字を打っている最中＝入力欄／日本語の変換中）。
 * 画面のキー操作はまずこれを通す。
 */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  return isTextEntryTarget(e.target) || isImeComposing(e);
}
