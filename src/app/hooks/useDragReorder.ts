// リストのドラッグ&ドロップ並び替え（#398）。当初はネイティブ HTML5 DnD だったが、持ち手が <button> 等の
// フォーム要素だと WebView（WebView2/WebKit）で dragstart が発火せず「掴めるのに並ばない」不具合になった（#398 再対応）。
// そこで Pointer Events で実装し直した＝要素種別（button/div/span）に依存せず確実に動き、jsdom で実操作相当の
// テストも書ける。アクセシブルな並び替えは呼び出し側の ↑/↓（←/→）ボタンが担う（handle は aria-hidden の見た目・#398 レビュー）。
//
// ⚠️ **掴む作法は自前で持たない**（#714-4）。以前はこのフックだけが #398 当時の自前実装のままで、
// ADR-0034 決定9 の作法を3つ満たしていなかった：
//
// | 作法 | 以前のここ | いま |
// |---|---|---|
// | 少し動かすまで掴まない | **押した瞬間に掴んだ扱い**＝元が薄くなり、1〜2px の震えで隣のすき間が確定した | `usePointerDrag`（`DRAG_START_PX`） |
// | `Escape` でやめる | **中止できない**＝同じアプリで `Escape` の意味が2つ（列・欄・帯・色の面はやめられる） | `usePointerDrag`（元へ戻す＝並べ替えない） |
// | 掴んだ指だけ見る | `pointerId` を見ず、**取り逃がした後の無関係な離しでそこへ落ちた** | `usePointerDrag`（確定）＋ここ（すき間の追随） |
//
// ADR-0034 は「共有部品に足りないものは**共通核の修繕**として入れ、場面編集にも同時に効かせる」としているので、
// ADR-0032 の凍結（場面形式の編集機能の拡張）には当たらない＝**割れていた作法を1つに戻すだけ**。
//
// ここに残るのは**落とし先の決め方**だけ＝どのすき間に入るか（#771(c)）と、すき間→挿入位置の直し。
import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { gapAtPosition, insertIndexForGap } from "../../domain/reorder";
import { visibleRectOf } from "../timelineDrop";
import { useEdgeAutoScroll } from "./useEdgeAutoScroll";
import type { ScrollAxis } from "./useEdgeAutoScroll";
import { usePointerDrag } from "./usePointerDrag";

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
  /**
   * 並びの各要素（落下先）に付ける props。ドラッグ中は**半分より手前か後ろか**ですき間を決める。
   * `ref` は**端まで運んで送っている間に位置から引き直す**ため（#714 項目5）＝指が止まっていても線が追いつく。
   */
  dropProps: (index: number) => {
    onPointerMove: (e: ReactPointerEvent) => void;
    ref: (el: HTMLElement | null) => void;
  };
}

/**
 * @param onReorder ドロップ（離した）時に呼ぶ。fromId（掴んだ項目 id）を **toIndex＝すき間から直した
 *   挿入位置**（`insertIndexForGap`）へ動かす。「重なっていた項目の index」ではない（#771(c)）。
 *   安定した参照（store アクション等）を渡すこと。
 */
export function useDragReorder(
  onReorder: (fromId: string, toIndex: number) => void,
  opts: {
    /** 並びの向き（既定＝縦）。**半分より手前か後ろか**を測る軸に使う。 */
    axis?: ScrollAxis;
    /**
     * 並びをスクロールさせている枠（#714 項目5）。渡すと**端まで運んだときに送る**。
     * 渡さなければ送らない（＝いままでどおり見えている範囲だけ）。
     */
    scroller?: () => HTMLElement | null;
  } = {},
): DragReorder {
  const axis = opts.axis ?? "y";
  const beginDrag = usePointerDrag();
  // 端送りは置く・運ぶ側と**同じ部品**（速さ・行き止まり・毎フレームの引き直しの規則を持たない）。
  const autoScroll = useEdgeAutoScroll(0 /* 名前の欄のような「中身が見えない幅」は無い */, axis);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overGap, setOverGap] = useState<number | null>(null);
  // 落とし先の pointermove は**この関数の外**（並びの各要素）から来るので、最新値は ref で持つ
  // （state のクロージャ陳腐化を避ける）。
  const draggingIdRef = useRef<string | null>(null);
  const fromIndexRef = useRef<number | null>(null);
  const overGapRef = useRef<number | null>(null);
  /**
   * 押している間だけ立つ（**掴む前も含む**）。しきい値を越える前の下ごしらえに使う。
   * `pointerId` も持つのは、**すき間の追随でも掴んだ指だけを見る**ため（別の指が並びの上を通っても動かない）。
   */
  const pressedRef = useRef<{ id: string; index: number; pointerId: number } | null>(null);
  /**
   * まだ見せていないすき間。
   * ⚠️ 落とし先（要素）の `pointermove` は、しきい値を判定する `usePointerDrag`（window）**より先**に走る。
   * ここに控えておかないと、**掴んだと決まった当の動き**のすき間を取りこぼし、次に動かすまで線が出ない。
   */
  const candidateRef = useRef<number | null>(null);
  /** 並びの各要素（位置から引き直すのに使う）。付け外しは `dropProps` の `ref`。 */
  const itemsRef = useRef<Map<number, HTMLElement>>(new Map());

  const reset = (): void => {
    setDraggingId(null);
    setOverGap(null);
    draggingIdRef.current = null;
    fromIndexRef.current = null;
    overGapRef.current = null;
    pressedRef.current = null;
    candidateRef.current = null;
  };

  /**
   * いまの指の位置からすき間を引き直す（#714 項目5）。
   * ⚠️ **送っている間は指が止まったまま**なので、落とし先の要素からは `pointermove` が来ない。
   * 引き直さないと線は止まったままで、離すと**送る前の場所**へ落ちる。
   */
  const regap = (ev: PointerEvent): void => {
    // ⚠️ **添字は 0..n-1 が密であることに寄りかかっている**（両画面とも `map((_, i) => dropProps(i))`）。
    // 一部だけ付けない使い方が出ると、すき間の番号が黙ってずれる。
    const entries = [...itemsRef.current.entries()].sort((a, b) => a[0] - b[0]);
    if (entries.length === 0) return;
    const bounds = entries.map(([, el]) => {
      const r = el.getBoundingClientRect();
      return axis === "x" ? { start: r.left, end: r.right } : { start: r.top, end: r.bottom };
    });
    // ⚠️ **見えている範囲へ丸めてから当てる**（#714 項目5 レビュー）＝送る向きのはみ出しは許す設計なので、
    // 生の位置で当てると**切り取られて見えていない項目**が落とし先になり、離すと画面外へ置かれる
    // （置く側は `visibleRectOf` で当てている＝2つの当たり判定を割らない）。
    const box = opts.scroller?.();
    const view = box ? visibleRectOf(box) : null;
    const raw = axis === "x" ? ev.clientX : ev.clientY;
    const lo = view ? (axis === "x" ? view.left : view.top) : -Infinity;
    const hi = view ? (axis === "x" ? view.right : view.bottom) : Infinity;
    const gap = gapAtPosition(bounds, Math.min(hi, Math.max(lo, raw)));
    if (gap != null) showGap(gap); // 決められないときは**いまの線を保つ**（余白でちらつかせない）
  };

  const showGap = (gap: number | null): void => {
    if (overGapRef.current === gap) return;
    overGapRef.current = gap;
    setOverGap(gap);
  };

  const drop = (): void => {
    const from = draggingIdRef.current;
    const fromIndex = fromIndexRef.current;
    const gap = overGapRef.current;
    reset();
    // 位置不変（同じ場所へ戻す）は onReorder 側が no-op（projectStore.moveSceneToIndex は変化なしなら履歴に積まない）。
    // すき間 → 入れる位置の直しは domain の1か所（`insertIndexForGap`）＝画面で数え直さない。
    if (from != null && gap != null && fromIndex != null) onReorder(from, insertIndexForGap(gap, fromIndex));
  };

  return {
    draggingId,
    overGap,
    handleProps: (id, index) => ({
      onPointerDown: (e) => {
        if (e.button !== 0) return; // 主ボタン以外（右クリック等）は掴まない＝`usePointerDrag` と同じ規則
        // タッチは pointerdown した要素へ暗黙のポインタキャプチャが掛かり、落下先の pointermove が届かなくなる。
        // キャプチャを解放して、マウスと同様「今ポインタが乗っている要素」へ pointermove を届かせる（#398 レビュー・タッチ対応）。
        // マウスは暗黙キャプチャが無く hasPointerCapture=false＝no-op。未対応環境（jsdom 等）は try/catch で無視。
        try {
          const el = e.currentTarget as Element;
          if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
        } catch {
          /* 未対応/未キャプチャは無視 */
        }
        // ⚠️ **控えを立てるのは `beginDrag` の後**（レビュー指摘・2名が独立に検出）。`usePointerDrag` は
        // 「同時に2つは走らない」ので、**前のドラッグが生きていれば `begin` の中でそれをやめる**＝
        // 下の `onCancel`（＝`reset()`）が同期で走り、先に立てた控えをその場で消す。消えると `dropProps` が
        // 素通りし続け、**元は薄くなるのにどこにも入らない**（#398「掴めるのに並ばない」の再来）。
        // 到達するのは「離したのを取り逃がしたまま、動かさずにもう一度押した」とき。
        beginDrag(e, {
          onStart: () => {
            draggingIdRef.current = id;
            fromIndexRef.current = index;
            setDraggingId(id);
            showGap(candidateRef.current); // 掴んだと決まった当の動きのすき間を取りこぼさない
          },
          // すき間は落とし先の要素が測る（`dropProps`）＝どの要素の上に居るかは要素自身が知っている。
          // ⚠️ **端まで運んだら送る**（#714 項目5）＝送った分だけ並びが動くので、毎フレーム位置から引き直す。
          onMove: (ev) => opts.scroller && autoScroll.track(opts.scroller(), ev, regap),
          onEnd: (_ev, started) => {
            autoScroll.stop();
            if (!started) { reset(); return; } // 動かさずに離した＝ただのクリック（並べ替えない）
            drop();
          },
          // `Escape`／`pointercancel`／取り逃がし／画面を離れた＝**元へ戻す**（並べ替えない）。
          onCancel: () => { autoScroll.stop(); reset(); },
        });
        pressedRef.current = { id, index, pointerId: e.pointerId };
        candidateRef.current = null;
      },
    }),
    dropProps: (index) => ({
      ref: (el) => {
        if (el) itemsRef.current.set(index, el);
        else itemsRef.current.delete(index);
      },
      onPointerMove: (e) => {
        // 押していない（通常のマウス移動）／**別の指**（掴んだ指だけ見る＝`usePointerDrag` と同じ規則）。
        if (pressedRef.current == null || pressedRef.current.pointerId !== e.pointerId) return;
        // **半分より手前ならその手前のすき間・後ろなら後ろのすき間**（#771(c)）。
        // ⚠️ **規則は domain の1か所**（`gapAtPosition`・#714 項目5 レビュー）＝送っている間の引き直しと
        // 同じ式を通す。手で同じ計算を2つ持つと、片方だけ直したときに黙ってずれる。
        // 1項目だけ渡すので、返るのは 0（手前）／1（後ろ）／`null`（実寸が取れない）。
        const r = e.currentTarget.getBoundingClientRect();
        const bounds = axis === "x" ? { start: r.left, end: r.right } : { start: r.top, end: r.bottom };
        const p = axis === "x" ? e.clientX : e.clientY;
        const gap = index + (gapAtPosition([bounds], p) ?? 0);
        candidateRef.current = gap;
        if (draggingIdRef.current != null) showGap(gap); // 掴む前は見せない（震えで線が出ない）
      },
    }),
  };
}
