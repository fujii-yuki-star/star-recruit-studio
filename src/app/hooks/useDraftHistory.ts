// 画面ローカルの下書き（draft）に取り消し/やり直しを与える汎用フック（#547 P2-3）。
//
// テンプレ作成エディタ（LooksEditScreen）は編集を store でなく画面ローカル state に持つため、store の Undo
// （ADR-0020）が使えない。#547 P1-1 で store Undo の対象画面から外した結果、この画面だけ復旧手段が
// 「破棄して戻る」しか無く、1回の誤ドラッグで全編集の破棄を迫られていた（§7 の「取り消せる」UX から乖離）。
//
// 履歴の意味論は store と同じものを共有する：スナップショット方式・上限 HISTORY_LIMIT・新しい操作で future を捨てる
// （純粋関数は `domain/project/history.ts`＝単一の参照元。ここで再実装しない・§2-7/§4）。
// グループ（連続編集を1履歴に合成）も store の begin/endHistoryGroup と同じ「遅延記録」規約：
// begin だけでは積まず、グループ中の**最初の実変更**で1回だけ「編集前」を記録する（未変更 focus では積まない）。
import { useCallback, useMemo, useState } from "react";
import { emptyHistory, recordSnapshot, redoSnapshot, undoSnapshot, type HistoryStacks } from "../../domain/project/history";

/** 値と履歴とグループ状態をまとめて1つの state に持つ（更新子を純粋に保ち、二重記録を避ける）。 */
interface DraftHistoryState<T> {
  value: T;
  history: HistoryStacks<T>;
  /** グループの入れ子深さ（0＝グループ外）。 */
  groupDepth: number;
  /** グループ中でまだ「編集前」を記録していないか（遅延記録）。 */
  groupPending: boolean;
  /** まとめの世代（畳むたびに+1・#817 レビュー）。 */
  groupGen: number;
}

export interface DraftHistory<T> {
  /** 現在の下書き。 */
  value: T;
  /** 下書きの更新（値でも更新関数でも可）。適用前を履歴へ積む。 */
  set: (next: T | ((cur: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * 連続編集の開始/終了（1ドラッグ・1フォーカスを1履歴に合成）。
   * **ドラッグ境界は操作元から明示的に通知すること**：オーバーレイのレイヤー/ハンドルは `onPointerDown` で
   * `stopPropagation` するため、祖先で pointerdown を拾う実装では発火しない（＝pointermove ごとに1履歴になり
   * 履歴上限を食い潰す）。`TemplateLayerOverlay`/`FreeLayoutOverlay` の `onInteractionStart/End` へ繋ぐ。
   */
  beginGroup: () => void;
  endGroup: () => void;
  /** テキスト欄に spread：フォーカス中の連続入力を1履歴に。 */
  textGroup: { onFocus: () => void; onBlur: () => void };
  /**
   * まとめの**世代**（#817 レビュー 🔴）。取り消し・やり直しで畳むたびに1つ上がる。
   * 持ち主（矢印のまとめ）は開いた時点の値を控え、**変わっていたら自分のまとめはもう無い**と判断する
   *（見ないと、畳まれた後も開いているつもりで開き直さず**1押下＝1履歴**になり上限を流し切る）。
   */
  groupGen: number;
}

/** 取り消し・やり直しの後は、開いていたまとめを閉じた状態にする（#817-1）。 */
const CLOSED_GROUP = { groupDepth: 0, groupPending: false } as const;

/**
 * 画面ローカル下書きの取り消し/やり直し。
 * @param initial 初期値（`useState` と同じく遅延初期化関数も可）。
 * 注意：`T` が関数型のときは更新関数と区別できない（`useState` と同じ制約）。
 */
export function useDraftHistory<T>(initial: T | (() => T)): DraftHistory<T> {
  const [state, setState] = useState<DraftHistoryState<T>>(() => ({
    value: typeof initial === "function" ? (initial as () => T)() : initial,
    history: emptyHistory<T>(),
    groupDepth: 0,
    groupPending: false,
    groupGen: 0,
  }));

  const set = useCallback((next: T | ((cur: T) => T)) => {
    setState((s) => {
      const resolved = typeof next === "function" ? (next as (cur: T) => T)(s.value) : next;
      if (Object.is(resolved, s.value)) return s; // 変化なし＝履歴も積まない（空の取り消しを作らない）
      if (s.groupDepth > 0) {
        // グループ中：記録済みなら積まない（1キーストローク/1tick ごとに積まない）。
        if (!s.groupPending) return { ...s, value: resolved };
        // グループ中の最初の実変更＝ここで初めて「編集前」を記録する（store の pushHistory と同じ遅延記録）。
        return { ...s, value: resolved, history: recordSnapshot(s.history, s.value), groupPending: false };
      }
      return { ...s, value: resolved, history: recordSnapshot(s.history, s.value) }; // グループ外＝1操作1履歴
    });
  }, []);

  // ⚠️ **戻すときは開いているまとめを畳む**（#817-1）＝畳まないと、戻した**後**の編集が
  // 「まとめの続き」とみなされて**履歴に積まれず**、`future` も捨てられない。実測＝矢印で動かす→
  // 待ち時間の内に取り消す→もう一度動かす、で**その移動が取り消せず**、やり直しで**黙って消える**。
  // 取り消しの前後で「まとめの続き」は成り立たない（戻した値はまとめを開いた時点のものではない）。
  // タイムライン形式の `restore` と同じ扱い（同じ概念を同じ挙動に＝ADR-0026②）。
  const undo = useCallback(() => {
    setState((s) => {
      const r = undoSnapshot(s.history, s.value);
      return r ? { ...s, ...CLOSED_GROUP, groupGen: s.groupGen + 1, value: r.restored, history: r.history } : s; // 戻せなければ何もしない
    });
  }, []);

  const redo = useCallback(() => {
    setState((s) => {
      const r = redoSnapshot(s.history, s.value);
      return r ? { ...s, ...CLOSED_GROUP, groupGen: s.groupGen + 1, value: r.restored, history: r.history } : s; // やり直せなければ何もしない
    });
  }, []);

  const beginGroup = useCallback(() => {
    // 深さ0→1 で「保留」にするだけ（snapshot は最初の set まで遅延＝未変更 focus で積まない）。
    setState((s) => (s.groupDepth === 0 ? { ...s, groupDepth: 1, groupPending: true } : { ...s, groupDepth: s.groupDepth + 1 }));
  }, []);

  const endGroup = useCallback(() => {
    setState((s) => ({ ...s, groupDepth: Math.max(0, s.groupDepth - 1) }));
  }, []);

  /**
   * ⚠️ **`blur` が来ない道は塞いでいない**（#847 で据え置いた・理由を残す）＝フォーカス中に欄が消えると
   * `blur` は来ないので、まとめが開きっぱなしになる（実機の道＝ADR-0033 の欄の配置の組み替え）。
   *
   * `useHistoryGroup` 側は**後始末つき ref を欄へ配って寿命に縛った**が、この `textGroup` を使う
   * `LooksEditScreen` は欄を**コンテナで委譲**して束ねており（`PanelLayoutView` の外側に1か所）、
   * コンテナは組み替えでは unmount しない＝**同じ形では塞げない**。
   *
   * **据え置いた理由**＝ここの履歴は**この画面の中だけ**（`useState`）で、自動保存も無い。
   * 固着しても波及するのは「取り消しが1段大きくまとまる」までで、`useHistoryGroup` 側のような
   * **編集が保存されなくなる**実害には至らない（やり直しでも戻せる）。
   * ⚠️ ただしこの画面は**取り消しが唯一の戻り道**なので、軽いのは実害の質であって、直さない約束ではない。
   * 塞ぐなら (a) 同じ後始末つき `ref` を欄へ配る／(b) コンテナが開けた要素を控え、レンダーごとの効果で
   * `!el.isConnected` なら畳む（組み替えの後は必ず1回レンダーが走る）。
   */
  const textGroup = useMemo(() => ({ onFocus: beginGroup, onBlur: endGroup }), [beginGroup, endGroup]);

  return {
    value: state.value,
    set,
    undo,
    redo,
    canUndo: state.history.past.length > 0,
    canRedo: state.history.future.length > 0,
    beginGroup,
    endGroup,
    textGroup,
    groupGen: state.groupGen,
  };
}
