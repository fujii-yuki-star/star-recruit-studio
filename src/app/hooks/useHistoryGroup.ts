// 連続編集を1つの Undo 履歴にまとめるためのハンドラ束（#389）。
// テキスト欄の1キーストロークやスライダーの1tick ごとに pushHistory していると、履歴上限（50）を食い潰し
// Undo が1文字ずつしか戻らない。beginHistoryGroup/endHistoryGroup で囲むと、グループ中は**最初の実変更で1回だけ**
// 記録し以降の pushHistory は no-op になるため、「フォーカス中の入力」「1回のドラッグ」が1履歴に合成される
// （未変更 focus/pointerdown では記録しない＝遅延記録）。ADR-0020・FREE ドラッグと同機構。
// 注意（**場面形式だけの話**）：場面形式の履歴 slice は meta/parts/scenes のみ（assets は対象外・ADR-0020）。
// asset を更新する調整（例: クリップ設定）はそもそも Undo 対象外なので、`useHistoryGroup` を付けても効かない＝付けないこと。
// **タイムライン形式は文書まるごとを積む**ので、この除外は無い（素材の欄に付けても効く）。
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";

/** まとめ方（作法）そのもの。**どの形式の履歴に効かせるかだけ**を差し替えて共有する（§6・ADR-0026②）。 */
export interface HistoryGroupHandlers {
  /** テキスト欄に spread：フォーカス中の連続入力を1履歴に（focus で開始・blur で終了）。 */
  textGroup: { onFocus: () => void; onBlur: () => void };
  /** スライダー等に spread：1回のドラッグ中の連続変更を1履歴に（pointerdown で開始・**window** で終了を必ず拾う）。 */
  dragGroup: { onPointerDown: () => void };
}

function handlers(begin: () => void, end: () => void): HistoryGroupHandlers {
  return {
    textGroup: { onFocus: begin, onBlur: end },
    // ドラッグ開始で begin し、次の pointerup/pointercancel を **window で** 拾って end する（one-shot で自己解除）。
    // 要素上の onPointerUp 頼みだと、スライダー外で指を離した/要素がドラッグ中に unmount した等で取りこぼすと、
    // グループが開きっぱなし＝以後の記録が全て no-op になり履歴が壊れる。
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

/**
 * タイムライン編集（別形式・#708）用。**同じ作法**をこの形式の履歴へ効かせる。
 *
 * ⚠️ `textGroup` は `blur` で閉じるが、**フォーカス中に欄が消えると `blur` は来ない**（仕様）。
 * 欄が入れ替わりうる場面では `resetHistoryGroup()` で畳むこと（`TimelineProjectScreen` が呼んでいる）。
 */
export function useTimelineHistoryGroup(): HistoryGroupHandlers {
  const begin = useTimelineStore((s) => s.beginHistoryGroup);
  const end = useTimelineStore((s) => s.endHistoryGroup);
  return handlers(begin, end);
}

/** 場面形式（`projectStore` の履歴）用。 */
export function useHistoryGroup(): HistoryGroupHandlers {
  const begin = useProjectStore((s) => s.beginHistoryGroup);
  const end = useProjectStore((s) => s.endHistoryGroup);
  return handlers(begin, end);
}
