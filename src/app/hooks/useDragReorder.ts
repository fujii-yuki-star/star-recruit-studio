// リストのドラッグ&ドロップ並び替え（#398）。当初はネイティブ HTML5 DnD だったが、持ち手が <button> 等の
// フォーム要素だと WebView（WebView2/WebKit）で dragstart が発火せず「掴めるのに並ばない」不具合になった（#398 再対応）。
// そこで Pointer Events で実装し直す＝要素種別（button/div/span）に依存せず確実に動き、jsdom で実操作相当の
// テストも書ける。掴む部分（handleProps）で pointerdown → ドラッグ開始、落下先（dropProps）の pointermove で
// 重なり位置を追い、window の pointerup で確定する（要素外で離しても確実に拾う）。
// アクセシブルな並び替えは呼び出し側の ↑/↓（←/→）ボタンが担う（handle は aria-hidden の見た目・#398 レビュー）。
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface DragReorder {
  /** ドラッグ中の項目 id（無ければ null）。ドラッグ元を薄く見せる等に使う。 */
  draggingId: string | null;
  /** ドラッグが今重なっている項目の index（無ければ null）。落下位置の目印表示に使う。 */
  overIndex: number | null;
  /** 掴む部分（把持部）に付ける props。ここで pointerdown するとドラッグが始まる。 */
  handleProps: (id: string) => { onPointerDown: (e: ReactPointerEvent) => void };
  /** 並びの各要素（落下先）に付ける props。ドラッグ中に重なると index を保持する。 */
  dropProps: (index: number) => { onPointerMove: (e: ReactPointerEvent) => void };
}

/**
 * @param onReorder ドロップ（pointerup）時に呼ぶ。fromId（掴んだ項目 id）を toIndex（重なっていた index）へ動かす。
 *   安定した参照（store アクション等）を渡すこと（ドラッグ中に window リスナを張り替えないため）。
 */
export function useDragReorder(onReorder: (fromId: string, toIndex: number) => void): DragReorder {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  // window の pointerup（要素外で離しても拾う）で最新値を読むための ref（state のクロージャ陳腐化を避ける）。
  const draggingIdRef = useRef<string | null>(null);
  const overIndexRef = useRef<number | null>(null);

  const reset = (): void => {
    setDraggingId(null);
    setOverIndex(null);
    draggingIdRef.current = null;
    overIndexRef.current = null;
  };

  // ドラッグ中だけ window を監視：pointerup=確定（どこで離しても拾う）、pointercancel=中断（並べ替えず後始末）。
  useEffect(() => {
    if (draggingId == null) return;
    const drop = (): void => {
      const from = draggingIdRef.current;
      const to = overIndexRef.current;
      reset();
      // 位置不変（同じ場所へ戻す）は onReorder 側が no-op（projectStore.moveSceneToIndex は変化なしなら履歴に積まない）。
      if (from != null && to != null) onReorder(from, to);
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
    overIndex,
    handleProps: (id) => ({
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
        overIndexRef.current = null;
        setDraggingId(id);
        setOverIndex(null);
      },
    }),
    dropProps: (index) => ({
      onPointerMove: () => {
        if (draggingIdRef.current == null) return; // ドラッグ中でなければ無視（通常のマウス移動）
        if (overIndexRef.current !== index) {
          overIndexRef.current = index;
          setOverIndex(index);
        }
      },
    }),
  };
}
