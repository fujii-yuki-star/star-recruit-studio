// リストのドラッグ&ドロップ並び替え（#398）。ネイティブ HTML5 DnD を使う軽量実装（外部ライブラリ不要）。
// 掴む部分（handleProps）と落下先（dropProps）を分けて返す＝表の行のように内側にボタンがある要素でも、
// 「持ち手だけドラッグ開始・行全体を落下先」にできる。並び替えの実体は onReorder（呼び出し側の store アクション）。
import { useState } from "react";
import type { DragEvent } from "react";

export interface DragReorder {
  /** ドラッグ中の項目 id（無ければ null）。ドラッグ元を薄く見せる等に使う。 */
  draggingId: string | null;
  /** ドラッグが今重なっている項目の index（無ければ null）。落下位置の目印表示に使う。 */
  overIndex: number | null;
  /** 掴む部分（把持部）に付ける props。ここを掴んで動かす。 */
  handleProps: (id: string) => {
    draggable: true;
    onDragStart: (e: DragEvent) => void;
    onDragEnd: () => void;
  };
  /** 並びの各要素（落下先）に付ける props。重なり中は index を保持し、ドロップで onReorder を呼ぶ。 */
  dropProps: (index: number) => {
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
}

/**
 * @param onReorder ドロップ時に呼ぶ。fromId（掴んだ項目 id）を toIndex（落下先の index）へ動かす。
 */
export function useDragReorder(onReorder: (fromId: string, toIndex: number) => void): DragReorder {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const reset = (): void => {
    setDraggingId(null);
    setOverIndex(null);
  };

  return {
    draggingId,
    overIndex,
    handleProps: (id) => ({
      draggable: true,
      onDragStart: (e) => {
        setDraggingId(id);
        e.dataTransfer.effectAllowed = "move";
        // Firefox 等は dataTransfer に何か set しないと DnD が始まらないことがあるため無害な値を入れる。
        try {
          e.dataTransfer.setData("text/plain", id);
        } catch {
          /* setData 不可の環境は無視（ドラッグ自体は effectAllowed で成立） */
        }
      },
      onDragEnd: reset,
    }),
    dropProps: (index) => ({
      onDragOver: (e) => {
        if (draggingId == null) return; // 外部からのドラッグ（ファイル等）は無視
        e.preventDefault(); // preventDefault しないと drop が発火しない
        e.dataTransfer.dropEffect = "move";
        if (overIndex !== index) setOverIndex(index);
      },
      onDrop: (e) => {
        if (draggingId == null) return;
        e.preventDefault();
        onReorder(draggingId, index);
        reset();
      },
    }),
  };
}
