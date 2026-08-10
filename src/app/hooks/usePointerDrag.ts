// 画面ぜんぶで共有する**ドラッグの作法**（ADR-0034 決定9・監査「ドラッグ規則の統一」）。
//
// この形式には掴む場所が3つある（欄の見出し＝ADR-0033／帯／キャンバス）。作法を場所ごとに書くと、
// **片方だけ直す**事故が起きる（実際に `Escape` の受け持ちで一度やっている）。規則はここ1か所：
//
// - **左ボタンのみ**（右クリックでメニューを開いたまま中身が書き換わるのを作らない）
// - **少し動かすまで掴まない**（押しただけで動かさない）
// - **掴んだ指だけ見る**（別の指の `pointerup` でそこへ落ちるのを作らない）
// - **`Escape` と `pointercancel` でやめられる**＝**元へ戻す**（掴んだまま戻れない、を作らない・§2-5）
// - やめている間は **`Escape` を受け持っている**と名乗る（外側の `Escape` まで走って選択が消えるのを防ぐ）
// - **アンマウントで後始末**（購読が残らない）
//
// ネイティブの HTML5 ドラッグ（`draggable`／`dragstart`）は使わない＝WebView では要素によって
// 発火しないことがある（`dnd-button-webview-gotcha`）。ポインタの生イベントで組む。
//
// ⚠️ 場面形式の自由配置（`FreeLayoutOverlay`）は要素の `setPointerCapture` で別に組んである。
// ADR-0034 決定6 は**キャンバスで動かす（#685）でそれを流用する**としているので、そのときに
// **この作法へ寄せる**こと（寄せないまま流用すると、同じ画面の中でドラッグの作法が2つになる）。
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { claimEscape } from "./escapeOwners";

let dragging = 0;
/**
 * **いま何かを掴んでいるか**（#686 レビュー）。掴んでいる間だけ止めたい外側の操作（取り消し）が見る。
 *
 * ⚠️ `hasEscapeOwner()` で代用しない＝あちらは右クリックメニュー・色や書体の選択欄も名乗るので、
 * それらを開いている間じゅう `Ctrl+Z` が**全画面で**無言で効かなくなる（掴む話より広く効いてしまう）。
 */
export function isPointerDragging(): boolean {
  return dragging > 0;
}

/**
 * **この作法の外で組んだドラッグ**を数えに入れる（#685 レビュー）。返す関数で必ず外すこと。
 *
 * ⚠️ `FreeLayoutOverlay`（キャンバスの直接操作）は `setPointerCapture` で別に組んであり、
 * ここを通らないと `isPointerDragging()` が常に `false`＝**掴んでいる最中に `Ctrl+Z` が通る**。
 * 帯では塞いだ穴が、キャンバスでは開いたままになる（同じ画面で作法が2つ）。
 */
export function registerExternalDrag(): () => void {
  dragging += 1;
  let released = false;
  return () => {
    if (released) return; // 二重に外しても数がずれない
    released = true;
    dragging -= 1;
  };
}

/** ここまで動いたら「掴んだ」とみなす（px）。 */
export const DRAG_START_PX = 4;

/**
 * その `click` が**キーボードで起こされたか**（#684 レビュー）。
 *
 * 掴めるものは指の経路を `pointerup`（`onEnd`）で完結させるので、`click` まで拾うと**二重に実行**する。
 * かといって「掴んだ」目印を立てて次の `click` を捨てる形にすると、**運んで別の所で離したときは
 * `click` が来ない**ので目印が残り、次の1回を食べる（キーボードでは押し直しても効かない）。
 * `detail` はマウスの押した回数で、キーボードで起こした `click` は 0＝**状態を持たずに見分けられる**。
 */
export function isKeyboardActivation(e: { detail: number }): boolean {
  return e.detail === 0;
}

export type DragHandlers = {
  /**
   * 掴んだとみなすまでの距離（px・既定 `DRAG_START_PX`）。**0 を渡すと最初の動きから効く**
   * ＝境界を掴んで広げるような「押した瞬間から追従してほしい」ものに使う（遊びを作らない）。
   */
  startPx?: number;
  /** 掴み始めた（しきい値を越えた）。 */
  onStart?: (ev: PointerEvent) => void;
  /** 動いている間（掴んだ後だけ呼ぶ）。 */
  onMove: (ev: PointerEvent) => void;
  /** 離した。`started` が false なら**ただのクリック**（動かしていない）。 */
  onEnd?: (ev: PointerEvent, started: boolean) => void;
  /**
   * やめた（`Escape`／`pointercancel`／アンマウント）＝**元へ戻す**。
   * `started` は掴んだ後にやめたか＝**中止の直後に来る `click` を捨てる**判断に使う
   * （`pointerdown` の `preventDefault` は `click` を止めない＝中止したのに実行される、を防ぐ）。
   */
  onCancel?: (started: boolean) => void;
};

/**
 * ドラッグを1つだけ走らせる。返す `begin` を `onPointerDown` に繋ぐ。
 * **同時に2つは走らない**（新しく掴んだら前のはやめる）。
 */
export function usePointerDrag() {
  const stopRef = useRef<(() => void) | null>(null);
  // 画面を離れたら後始末（購読と `Escape` の名乗りが残らない）。
  useEffect(() => () => stopRef.current?.(), []);

  const begin = (e: ReactPointerEvent, h: DragHandlers): void => {
    if (e.button !== 0) return; // 左ボタンのみ
    e.preventDefault(); // 文字の選択が走るとドラッグが途中で切れる
    stopRef.current?.(); // 走っているものがあればやめる
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    let started = false;
    let releaseEscape: (() => void) | null = null;

    const mine = (ev: PointerEvent): boolean => ev.pointerId === pointerId;
    const detach = (): void => {
      if (started) dragging -= 1; // 掴んだぶんだけ戻す（しきい値未満で終わったときは増やしていない）
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      releaseEscape?.(); // 外し忘れると `Escape` が永久に効かなくなる
      releaseEscape = null;
      stopRef.current = null;
    };
    const onMove = (ev: PointerEvent): void => {
      if (!mine(ev)) return;
      // 押していないのに動いている＝どこかで `pointerup` を取り逃がした（画面の外で離した・別の操作に取られた）。
      // 放っておくと影が指に付いたままになり、**次に無関係な所で離した瞬間**にそこへ置かれる。
      if (ev.buttons === 0) { onCancel(); return; }
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < (h.startPx ?? DRAG_START_PX)) return;
        started = true;
        dragging += 1;
        h.onStart?.(ev);
      }
      h.onMove(ev);
    };
    const onUp = (ev: PointerEvent): void => {
      if (!mine(ev)) return;
      detach();
      h.onEnd?.(ev, started);
    };
    const onCancel = (): void => {
      detach();
      h.onCancel?.(started);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") onCancel();
    };

    // 掴んでいる間は `Escape` を受け持っていると名乗る（中止しただけで外側まで走らせない）。
    releaseEscape = claimEscape();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    stopRef.current = onCancel;
  };

  return begin;
}
