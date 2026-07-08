// 連続編集を1つの Undo 履歴にまとめるためのハンドラ束（#389）。
// テキスト欄の1キーストロークやスライダーの1tick ごとに pushHistory していると、履歴上限（50）を食い潰し
// Undo が1文字ずつしか戻らない。beginHistoryGroup/endHistoryGroup で囲むと、グループ中は**最初の実変更で1回だけ**
// 記録し以降の pushHistory は no-op になるため、「フォーカス中の入力」「1回のドラッグ」が1履歴に合成される
// （未変更 focus/pointerdown では記録しない＝遅延記録）。ADR-0020・FREE ドラッグと同機構。
// 注意：履歴 slice は meta/parts/scenes のみ（assets は対象外・ADR-0020）。asset を更新する調整（例: クリップ設定）は
// そもそも Undo 対象外なので、このフックを付けても効かない＝付けないこと。
import { useProjectStore } from "../store/projectStore";

export function useHistoryGroup(): {
  /** テキスト欄に spread：フォーカス中の連続入力を1履歴に（focus で開始・blur で終了）。 */
  textGroup: { onFocus: () => void; onBlur: () => void };
  /** スライダー等に spread：1回のドラッグ中の連続変更を1履歴に（pointerdown で開始・**window** で終了を必ず拾う）。 */
  dragGroup: { onPointerDown: () => void };
} {
  const begin = useProjectStore((s) => s.beginHistoryGroup);
  const end = useProjectStore((s) => s.endHistoryGroup);
  return {
    textGroup: { onFocus: begin, onBlur: end },
    // ドラッグ開始で begin し、次の pointerup/pointercancel を **window で** 拾って end する（one-shot で自己解除）。
    // 要素上の onPointerUp 頼みだと、スライダー外で指を離した/要素がドラッグ中に unmount した等で取りこぼすと、
    // グループが開きっぱなし＝以後の pushHistory が全て no-op になり履歴が壊れる（pushHistory はグループ中 no-op）。
    // window で拾えば、どこで離しても・要素が消えても必ず閉じられる（begin/end は store アクションで unmount 後も有効）。
    dragGroup: {
      onPointerDown: () => {
        begin();
        const finish = (): void => {
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
          end();
        };
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
      },
    },
  };
}
