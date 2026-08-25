// 連続編集を1つの Undo 履歴にまとめるためのハンドラ束（#389）。
// テキスト欄の1キーストロークやスライダーの1tick ごとに pushHistory していると、履歴上限（50）を食い潰し
// Undo が1文字ずつしか戻らない。beginHistoryGroup/endHistoryGroup で囲むと、グループ中は**最初の実変更で1回だけ**
// 記録し以降の pushHistory は no-op になるため、「フォーカス中の入力」「1回のドラッグ」が1履歴に合成される
// （未変更 focus/pointerdown では記録しない＝遅延記録）。ADR-0020・FREE ドラッグと同機構。
// 注意（**場面形式だけの話**）：場面形式の履歴 slice は meta/parts/scenes のみ（assets は対象外・ADR-0020）。
// asset を更新する調整（例: クリップ設定）はそもそも Undo 対象外なので、`useHistoryGroup` を付けても効かない＝付けないこと。
// **タイムライン形式は文書まるごとを積む**ので、この除外は無い（素材の欄に付けても効く）。
import { useCallback, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { registerExternalDrag } from "./usePointerDrag";
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";

/** まとめ方（作法）そのもの。**どの形式の履歴に効かせるかだけ**を差し替えて共有する（§6・ADR-0026②）。 */
export interface HistoryGroupHandlers {
  /**
   * テキスト欄に spread：フォーカス中の連続入力を1履歴に（focus で開始・blur で終了）。
   *
   * ⚠️ **`ref` も一緒に渡すこと**（#847）＝`blur` だけでは閉じ切れない。**フォーカス中に欄が消えると
   * `blur` は来ない**ので、`ref` の後始末（React 19＝ref が返した関数が unmount で呼ばれる）で
   * **欄の寿命に縛って**閉じる。spread（`{...textGroup}`）なら自動で付く。手で配る場合は
   * `ref={textGroup.ref}` も忘れないこと。
   */
  textGroup: {
    /**
     * @param e **必須**（#847 レビュー ℹ️）＝どの欄が開けたかを覚えないと、`ref` の後始末が
     * 「自分のぶんか」を判定できず**閉じられない**（`blur` も来ないので開きっぱなしになる）。
     * spread（`{...textGroup}`）なら React が渡すので普段は意識しなくてよい。
     */
    onFocus: (e: { currentTarget: Element | null }) => void;
    onBlur: () => void;
    /** React 19 の後始末つき ref＝**返した関数が unmount で呼ばれる**（`null` では呼ばれない）。 */
    ref: (el: Element | null) => () => void;
  };
  /** スライダー等に spread：1回のドラッグ中の連続変更を1履歴に（pointerdown で開始・**window** で終了を必ず拾う）。 */
  dragGroup: { onPointerDown: (e: ReactPointerEvent) => void };
}

function useHandlers(begin: () => void, end: () => void): HistoryGroupHandlers {
  /**
   * **いまのまとめを開けた欄**（`null`＝開けた欄が無い）。
   *
   * ⚠️ **どの欄が開けたかを覚える必要がある**（#847）＝`end()` は**数を1つ減らす**だけ
   * （`Math.max(0, depth-1)`）なので、開けていない欄が消えたときに閉じると**別の欄のまとめ**を
   * 早く閉じてしまう。React 19 の後始末つき ref は消える当人（`el`）を閉じ込められるので、
   * **自分が開けたときだけ**閉じられる（#842 の共有 ref では作れなかった精度）。
   */
  const openedBy = useRef<Element | null>(null);
  /**
   * **自分が開けたまとめが、いま開いているか**。`openedBy`（どの欄か）と分けているのは、
   * **二度返さない**ため＝寿命（`ref` の後始末）で閉じた後に `blur` が来ても、数を2回返さない
   *（`end` は数を1つ減らすだけなので、返しすぎると**他人のまとめ**まで畳む）。
   */
  const open = useRef(false);
  const onFocus = useCallback((e: { currentTarget: Element | null }) => {
    open.current = true;
    openedBy.current = e.currentTarget; // どの欄が開けたか＝`ref` の後始末が自分のぶんだけ閉じるための鍵
    begin();
  }, [begin]);
  const onBlur = useCallback(() => {
    // ⚠️ **二度返さない**＝寿命（下の `ref`）で既に閉じた後に `blur` が来ることがある。
    // 数を返しすぎると**他人のまとめ**まで畳んでしまう（`end` は数を1つ減らすだけ）。
    if (!open.current) return;
    open.current = false;
    openedBy.current = null;
    end();
  }, [end]);
  // ⚠️ **同一性を保つ**＝毎レンダー新しい関数を渡すと、React が前の後始末を呼び直すので
  // **打っている最中にまとめが閉じる**（1文字ごとに1履歴＝上限を食い潰す）。
  const ref = useCallback((el: Element | null) => () => {
    if (!open.current || openedBy.current !== el) return; // 開けていない欄が消えただけ＝他人のまとめを閉じない
    open.current = false;
    openedBy.current = null;
    end(); // `blur` は来ないので、ここが唯一の閉じ手
  }, [end]);
  const textGroup = useMemo(() => ({ onFocus, onBlur, ref }), [onFocus, onBlur, ref]);
  return {
    textGroup,
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
 * ⚠️ `textGroup` は `blur` で閉じるが、**フォーカス中に欄が消えると `blur` は来ない**（仕様）＝
 * **`ref` も渡すこと**（#847）。ref の後始末が**欄の寿命に縛って**閉じるので、
 * 「欄が消える」道については入口を数え上げなくてよい。
 *
 * ⚠️ **`resetHistoryGroup()` の呼び出しは外さないこと**（#847 レビュー ℹ️）＝役割が違う。
 * ref が塞ぐのは「**欄が消える**」道だけで、`TimelineProjectScreen` が選択の変化で呼んでいるのは
 * 「**欄は生き残ったまま選択だけ変わる**」道（#813＝掴んだ足元で開いた古いまとめを畳む）。
 * こちらを外すと、1操作ずつ積まれて上限50を1回のドラッグで流し切る不具合が戻る。
 */
export function useTimelineHistoryGroup(): HistoryGroupHandlers {
  const begin = useTimelineStore((s) => s.beginHistoryGroup);
  const end = useTimelineStore((s) => s.endHistoryGroup);
  return useHandlers(begin, end);
}

/** 場面形式（`projectStore` の履歴）用。 */
export function useHistoryGroup(): HistoryGroupHandlers {
  const begin = useProjectStore((s) => s.beginHistoryGroup);
  const end = useProjectStore((s) => s.endHistoryGroup);
  return useHandlers(begin, end);
}
