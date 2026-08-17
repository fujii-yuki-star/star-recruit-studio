// リストのドラッグ&ドロップ並び替え（#398）。当初はネイティブ HTML5 DnD だったが、持ち手が <button> 等の
// フォーム要素だと WebView（WebView2/WebKit）で dragstart が発火せず「掴めるのに並ばない」不具合になった（#398 再対応）。
// そこで Pointer Events で実装し直す＝要素種別（button/div/span）に依存せず確実に動き、jsdom で実操作相当の
// テストも書ける。掴む部分（handleProps）で pointerdown → ドラッグ開始、落下先（dropProps）の pointermove で
// 重なり位置を追い、window の pointerup で確定する（要素外で離しても確実に拾う）。
// アクセシブルな並び替えは呼び出し側の ↑/↓（←/→）ボタンが担う（handle は aria-hidden の見た目・#398 レビュー）。
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { insertIndexForGap } from "../../domain/reorder";

export interface DragReorder {
  /** ドラッグ中の項目 id（無ければ null）。ドラッグ元を薄く見せる等に使う。 */
  draggingId: string | null;
  /**
   * 落とすと入る**すき間**（0〜n・無ければ null）。**挿入線をここへ出す**（#771(c)）。
   *
   * ⚠️ 以前は「重なっている項目の index」を返していたが、それだと**同じ手つきが向きで別の意味**に
   * なる（前へ動かすとその手前・後ろへ動かすとその後ろに入る＝1つずれる）。**間**で決めれば
   * 「どこに入るか」が指したとおりになり、線でそのまま見せられる。
   */
  overGap: number | null;
  /** 掴む部分（把持部）に付ける props。ここで pointerdown するとドラッグが始まる。 */
  handleProps: (id: string, index: number) => { onPointerDown: (e: ReactPointerEvent) => void };
  /** 並びの各要素（落下先）に付ける props。ドラッグ中は**半分より手前か後ろか**ですき間を決める。 */
  dropProps: (index: number) => { onPointerMove: (e: ReactPointerEvent) => void };
}

/**
 * @param onReorder ドロップ（pointerup）時に呼ぶ。fromId（掴んだ項目 id）を **toIndex＝すき間から直した
 *   挿入位置**（`insertIndexForGap`）へ動かす。「重なっていた項目の index」ではない（#771(c)）。
 *   安定した参照（store アクション等）を渡すこと（ドラッグ中に window リスナを張り替えないため）。
 */
export function useDragReorder(
  onReorder: (fromId: string, toIndex: number) => void,
  /** 並びの向き（既定＝縦）。**半分より手前か後ろか**を測る軸に使う。 */
  opts: { axis?: "x" | "y" } = {},
): DragReorder {
  const axis = opts.axis ?? "y";
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overGap, setOverGap] = useState<number | null>(null);
  // window の pointerup（要素外で離しても拾う）で最新値を読むための ref（state のクロージャ陳腐化を避ける）。
  const draggingIdRef = useRef<string | null>(null);
  const fromIndexRef = useRef<number | null>(null);
  const overGapRef = useRef<number | null>(null);

  const reset = (): void => {
    setDraggingId(null);
    setOverGap(null);
    draggingIdRef.current = null;
    fromIndexRef.current = null;
    overGapRef.current = null;
  };

  // ドラッグ中だけ window を監視：pointerup=確定（どこで離しても拾う）、pointercancel=中断（並べ替えず後始末）。
  useEffect(() => {
    if (draggingId == null) return;
    const drop = (): void => {
      const from = draggingIdRef.current;
      const fromIndex = fromIndexRef.current;
      const gap = overGapRef.current;
      reset();
      // 位置不変（同じ場所へ戻す）は onReorder 側が no-op（projectStore.moveSceneToIndex は変化なしなら履歴に積まない）。
      // すき間 → 入れる位置の直しは domain の1か所（`insertIndexForGap`）＝画面で数え直さない。
      if (from != null && gap != null && fromIndex != null) onReorder(from, insertIndexForGap(gap, fromIndex));
    };
    const cancel = (): void => reset(); // 中断（システムジェスチャ等）は並べ替えず状態だけ戻す
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [draggingId, onReorder]);

  return {
    draggingId,
    overGap,
    handleProps: (id, index) => ({
      onPointerDown: (e) => {
        if (e.button != null && e.button > 0) return; // 主ボタン以外（右クリック等）は無視
        e.preventDefault(); // ドラッグ中のテキスト選択・既定操作を抑止
        // タッチは pointerdown した要素へ暗黙のポインタキャプチャが掛かり、落下先の pointermove が届かなくなる。
        // キャプチャを解放して、マウスと同様「今ポインタが乗っている要素」へ pointermove を届かせる（#398 レビュー・タッチ対応）。
        // マウスは暗黙キャプチャが無く hasPointerCapture=false＝no-op。未対応環境（jsdom 等）は try/catch で無視。
        try {
          const el = e.currentTarget as Element;
          if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
        } catch {
          /* 未対応/未キャプチャは無視 */
        }
        draggingIdRef.current = id;
        fromIndexRef.current = index;
        overGapRef.current = null;
        setDraggingId(id);
        setOverGap(null);
      },
    }),
    dropProps: (index) => ({
      onPointerMove: (e) => {
        if (draggingIdRef.current == null) return; // ドラッグ中でなければ無視（通常のマウス移動）
        // **半分より手前ならその手前のすき間・後ろなら後ろのすき間**（#771(c)）。
        // 実寸が取れない環境（jsdom の既定）は手前側に倒す＝どちらかに決まっていれば線は出せる。
        const r = e.currentTarget.getBoundingClientRect();
        const mid = axis === "x" ? r.left + r.width / 2 : r.top + r.height / 2;
        const p = axis === "x" ? e.clientX : e.clientY;
        const gap = p >= mid && (axis === "x" ? r.width : r.height) > 0 ? index + 1 : index;
        if (overGapRef.current !== gap) {
          overGapRef.current = gap;
          setOverGap(gap);
        }
      },
    }),
  };
}
