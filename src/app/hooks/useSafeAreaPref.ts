// 「端の目安を出すか」の記憶（#265）。
//
// ⚠️ **画面の好みなので覚える**（ADR-0033・ADR-0034 決定14）＝倍率（文書の見え方）と違い、
// これは**その人の作り方**。開き直すたびに消えると毎回入れ直すことになる。
// 保存先は `localStorage`＝**プロジェクトの schema には入れない**（画面の好みは動画の中身ではない・§5。
// 節の開閉〔`sectionOpen.ts`〕・欄の配置〔ADR-0033〕と同じ流儀）。
//
// ⚠️ **画面ごとではなくアプリで1つ**＝節の開閉（画面ごとに顔ぶれが違う）と違い、これは
// 「端で切られないように作る人か」という**1つの好み**なので、場面編集で入れたのに
// 見た目パターン編集では消えている、を作らない。
import { useCallback, useEffect, useState } from "react";

const LS_KEY = "preview.safeArea";
/** 同じタブの他の使い手へ知らせる合図（`storage` は同じタブに届かない）。 */
const EVENT = "stario:safe-area-changed";

/**
 * いまの設定（このセッションの正）。
 *
 * ⚠️ **覚えられなくても、いまは効かせる**（プライベートモード等）＝`localStorage` を毎回読み直すと、
 * 保存に失敗したときに**押した直後に元へ戻る**（押せるのに何も起きない・§2-5）。
 * ディスクは「次に開いたときのため」の置き場で、**この場の正はこの変数**。
 */
let current = ((): boolean => {
  try {
    return localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
})();

/**
 * 「端の目安を出すか」と、その切り替え。
 *
 * ⚠️ **同じ画面の複数の入口で食い違わない**＝切り替えとプレビューは別の場所に居るので、
 * 合図（`CustomEvent`）で他の使い手へも知らせる。
 */
export function useSafeAreaPref(): [boolean, (next: boolean) => void] {
  const [on, setOnState] = useState(current);

  useEffect(() => {
    const sync = (): void => setOnState(current);
    window.addEventListener(EVENT, sync);
    // 待っている間に別の入口が変えていたら追いつく（後から出てきた使い手が古い値で始まらない）。
    sync();
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const setOn = useCallback((next: boolean) => {
    current = next;
    try {
      localStorage.setItem(LS_KEY, next ? "1" : "0");
    } catch { /* 覚えられなくても、この場では効かせる（次に開いたときは既定へ戻る） */ }
    window.dispatchEvent(new CustomEvent(EVENT));
  }, []);

  return [on, setOn];
}

/**
 * テスト用＝この場の正を入れ直す。
 *
 * ⚠️ **`localStorage.clear()` だけでは足りない**＝この場の正は**モジュールの変数**なので、
 * ディスクを消してもテストをまたいで残る（`resetAssetIdReservations` と同じ形＝アプリ起動中は
 * ずっと残るものを、テストごとに捨てる）。
 */
export function resetSafeAreaPrefTo(next: boolean): void {
  current = next;
}
