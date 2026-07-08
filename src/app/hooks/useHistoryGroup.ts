// 連続編集を1つの Undo 履歴にまとめるためのハンドラ束（#389）。
// テキスト欄の1キーストロークやスライダーの1tick ごとに pushHistory していると、履歴上限（50）を食い潰し
// Undo が1文字ずつしか戻らない。beginHistoryGroup/endHistoryGroup で囲むと、グループ中の pushHistory は
// no-op になり「フォーカス中の入力」「1回のドラッグ」が1履歴に合成される（ADR-0020・FREE ドラッグと同機構）。
import { useProjectStore } from "../store/projectStore";

export function useHistoryGroup(): {
  /** テキスト欄に spread：フォーカス中の連続入力を1履歴に（focus で開始・blur で終了）。 */
  textGroup: { onFocus: () => void; onBlur: () => void };
  /** スライダー等に spread：1回のドラッグ中の連続変更を1履歴に（pointerdown で開始・pointerup/cancel で終了）。 */
  dragGroup: { onPointerDown: () => void; onPointerUp: () => void; onPointerCancel: () => void };
} {
  const begin = useProjectStore((s) => s.beginHistoryGroup);
  const end = useProjectStore((s) => s.endHistoryGroup);
  return {
    textGroup: { onFocus: begin, onBlur: end },
    dragGroup: { onPointerDown: begin, onPointerUp: end, onPointerCancel: end },
  };
}
