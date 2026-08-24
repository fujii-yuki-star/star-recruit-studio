// 連続編集を1つの Undo 履歴にまとめるためのハンドラ束（#389）。
// テキスト欄の1キーストロークやスライダーの1tick ごとに pushHistory していると、履歴上限（50）を食い潰し
// Undo が1文字ずつしか戻らない。beginHistoryGroup/endHistoryGroup で囲むと、グループ中は**最初の実変更で1回だけ**
// 記録し以降の pushHistory は no-op になるため、「フォーカス中の入力」「1回のドラッグ」が1履歴に合成される
// （未変更 focus/pointerdown では記録しない＝遅延記録）。ADR-0020・FREE ドラッグと同機構。
// 注意（**場面形式だけの話**）：場面形式の履歴 slice は meta/parts/scenes のみ（assets は対象外・ADR-0020）。
// asset を更新する調整（例: クリップ設定）はそもそも Undo 対象外なので、`useHistoryGroup` を付けても効かない＝付けないこと。
// **タイムライン形式は文書まるごとを積む**ので、この除外は無い（素材の欄に付けても効く）。
import type { PointerEvent as ReactPointerEvent } from "react";
import { registerExternalDrag } from "./usePointerDrag";
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";

/** まとめ方（作法）そのもの。**どの形式の履歴に効かせるかだけ**を差し替えて共有する（§6・ADR-0026②）。 */
export interface HistoryGroupHandlers {
  /** テキスト欄に spread：フォーカス中の連続入力を1履歴に（focus で開始・blur で終了）。 */
  textGroup: { onFocus: () => void; onBlur: () => void };
  /** スライダー等に spread：1回のドラッグ中の連続変更を1履歴に（pointerdown で開始・**window** で終了を必ず拾う）。 */
  dragGroup: { onPointerDown: (e: ReactPointerEvent) => void };
}

function handlers(begin: () => void, end: () => void): HistoryGroupHandlers {
  return {
    textGroup: { onFocus: begin, onBlur: end },
    // ドラッグ開始で begin し、次の pointerup/pointercancel を **window で** 拾って end する（one-shot で自己解除）。
    // 要素上の onPointerUp 頼みだと、スライダー外で指を離した/要素がドラッグ中に unmount した等で取りこぼすと、
    // グループが開きっぱなし＝以後の記録が全て no-op になり履歴が壊れる。
    // window で拾えば、どこで離しても・要素が消えても必ず閉じられる（begin/end は store アクションで unmount 後も有効）。
    dragGroup: {
      onPointerDown: (e: ReactPointerEvent) => {
        // **左ボタンだけ**（数に入れる他の入口と同じ関門＝`usePointerDrag`／`useDragReorder`／`useCanvasDrag`）。
        // 右クリックは既定のメニューが開いて `pointerup` が届かないことがあり、数が戻らないと
        // **`Ctrl+Z` と倍率変更が全画面で無言のまま効かなくなる**（開きっぱなしより重い）。
        if (e.button !== 0) return;
        const pointerId = e.pointerId;
        begin();
        // **掴んでいる数に入れる**（#830）＝掴んでいる間の `Ctrl+Z` を止める。
        // スライダー（`<input type="range">`）は**入力欄扱いでも掴んでいる扱いでもない**ので、
        // 入れないと掴んだままキーが通る＝`undo` がまとめを畳み（#817）、**残りのドラッグが
        // 毎tick 1履歴**になって上限（50）を1回のドラッグで流し切る＝**取り消しでしか戻せない編集**
        // （場面の削除・種類の切替）を押し出す。
        // ⚠️ 畳まれたことを世代で知って**開き直す**のでは足りない＝掴んだ足元で文書が戻ると、
        // 離したときに**掴んだときと違う結果**になる（起点だけ古い）。帯・キャンバスで既に塞いだのと
        // 同じ理由で、ここも**到達自体を塞ぐ**（#686 レビューと同じ扱い・ADR-0026②）。
        // ⚠️ **`claimEscape()` とは対で名乗らない**（数に入れる他の入口＝`useCanvasDrag` は対で名乗る）。
        // native の `<input type="range">` は `Escape` で「やめる＝押す前へ戻す」ができないので、名乗ると
        // **外側の `Escape` が黙って死ぬ**だけになる（§2-5）。作法を揃える目的で足さないこと。
        // ⚠️ **`pointermove` の `buttons===0` 救済（`usePointerDrag` の作法）も足していない**＝あちらは
        // 掴んだ指を `pointerId` で見分けているが、ここは受け取っていないので、**別の指のホバー**で
        // まとめを早く閉じてしまい**この不具合そのものを再現する**。`range` は暗黙のポインタ捕捉が効き
        // 離しは必ず window まで来るので、いまはこの1経路で足りる。**捕捉の無い部品に付けるときは、
        // まず `pointerId` を受け取れるようにしてから**救済を足すこと。
        const release = registerExternalDrag();
        const finish = (ev?: Event): void => {
          // **掴んだ指だけ見る**（`useCanvasDrag` の `mine()` と同じ）＝2本目の指で別のスライダーを掴むと、
          // 先に離した1本目の `pointerup` が**両方**を閉じ、まだ握っている側の数まで返してしまう
          // ＝掴んだままの `Ctrl+Z` がその場で通り、塞いだ穴が開く。
          const pid = (ev as PointerEvent | undefined)?.pointerId;
          if (pid != null && pid !== pointerId) return;
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
          release(); // 掴んだぶんを必ず返す（返さないと以後 `Ctrl+Z` が全画面で効かなくなる）
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
