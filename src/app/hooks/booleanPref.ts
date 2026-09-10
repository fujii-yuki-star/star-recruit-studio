// **画面の好み**（はい／いいえの1つ）を覚える土台（#1103）。
//
// ⚠️ **読み書きそのものは持たない**＝`localStorage` を触るのは `infrastructure/appSettings`
// （`CLAUDE.md §4`＝外部I/O は `infrastructure` に隔離する）。ここが持つのは **React 側の糊**だけ＝
// ①この場の正（モジュールの変数）②同じタブの他の使い手への合図 ③テストのために正を入れ直す口。
//
// ⚠️ **写して増やさない**＝この糊は細かいところで間違えやすく、**双子の片方だけ直す**が起きる。
//
// ⚠️ **この糊（合図つき）を通るのは2つ**（`useSafeAreaPref` と `useSidebarCollapsed`）＝
// **同じ好みを複数の入口から切り替える**ものだけ。画面の中で閉じている好み
// （`SceneEditScreen` の「選択した要素だけ編集」／`TimelineProjectScreen` の「吸着」）は
// **合図が要らない**ので、`appSettings` の読み書きだけを使う（#1112 で寄せた）。
// ＝**読み書きは全員 `appSettings`**、**合図が要るものだけここを通る**、という線引き。
// ⚠️ **画面が `localStorage` を直に読む所は 0 件**（`grep -rn 'localStorage.getItem' src/app/screens` で確認）。
import { useCallback, useEffect, useState } from "react";
import { getBooleanSetting, setBooleanSetting } from "../../infrastructure/appSettings";

/** 1つの好みの、読み書きの口。 */
export interface BooleanPref {
  /** いまの値と、その切り替え。 */
  usePref: () => [boolean, (next: boolean) => void];
  /**
   * テスト用＝この場の正を入れ直す。
   *
   * ⚠️ **`localStorage.clear()` だけでは足りない**＝この場の正は**モジュールの変数**なので、
   * ディスクを消してもテストをまたいで残る（`resetAssetIdReservations` と同じ形）。
   */
  resetTo: (next: boolean) => void;
}

/**
 * 「はい／いいえ」の好みを1つ作る。
 *
 * @param lsKey 覚えの置き場。⚠️ **気軽に変えない**＝変えると利用者の記憶がその好みぶん消える。
 * @param eventName 同じタブの他の使い手へ知らせる合図（`storage` は同じタブに届かない）。
 * @param fallback 覚えが無いとき／読めないときの値。
 *
 * ⚠️ **別のウィンドウとは揃えていない**＝`storage` イベントは登録していない。いまは1つの
 * ウィンドウしか開かないアプリなので実害は無いが、**複数ウィンドウを開ける導線ができたら
 * ここに `storage` の受け口を足す**（1か所で済むように、土台の側に書いておく）。
 */
export function createBooleanPref(lsKey: string, eventName: string, fallback = false): BooleanPref {
  /**
   * いまの値（このセッションの正）。
   *
   * ⚠️ **覚えられなくても、いまは効かせる**（プライベートモード等）＝覚えを毎回読み直すと、
   * 保存に失敗したときに**押した直後に元へ戻る**（押せるのに何も起きない・§2-5）。
   * ディスクは「次に開いたときのため」の置き場で、**この場の正はこの変数**。
   */
  let current = getBooleanSetting(lsKey, fallback);

  function usePref(): [boolean, (next: boolean) => void] {
    const [on, setOnState] = useState(current);

    useEffect(() => {
      const sync = (): void => setOnState(current);
      window.addEventListener(eventName, sync);
      // 待っている間に別の入口が変えていたら追いつく（後から出てきた使い手が古い値で始まらない）。
      sync();
      return () => window.removeEventListener(eventName, sync);
    }, []);

    const setOn = useCallback((next: boolean) => {
      current = next;
      setBooleanSetting(lsKey, next);
      window.dispatchEvent(new CustomEvent(eventName));
    }, []);

    return [on, setOn];
  }

  return { usePref, resetTo: (next: boolean) => { current = next; } };
}
