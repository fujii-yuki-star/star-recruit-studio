// 画面を離れる前の関門（#719）。**遷移の入口は `App` の `navigate` ひとつ**なので、そこで一度だけ聞く。
//
// これまで離脱の確認は「動画の一覧へ」ボタンにしか繋がっておらず、**サイドバーからは素通し**だった。
// タイムライン編集は自動保存で、共通トップバーの保存ボタンを出さない（ADR-0032）ので、
// 保存に失敗したまま抜けると**確認も再試行も出ないまま編集が捨てられる**（`15 §6` の `TIMELINE_SAVE_FAILED`
// が「一覧へ戻ると編集は失われるので黙って捨てず聞く」と書いている約束を、片方の入口でしか果たしていなかった）。
//
// 画面ごとに `navigate` を書き換えて回るのではなく、**離れたくない側が名乗る**形にする
// （`escapeOwners` と同じ考え方）＝新しい画面が増えても、名乗るだけで関門に乗る。
import { useEffect, useRef } from "react";
import type { ScreenId } from "../data/mockData";

/**
 * 遷移してよいか。`false` を返した側が**答えを求める確認を出す責任**を持つ
 * （黙って止めると、押しても何も起きない画面になる＝§2-5）。
 */
export type NavigationGuard = (to: ScreenId) => boolean;

/**
 * いま名乗っている関門。**数える**（`escapeOwners` と同じ形）＝1つしか持たないと、
 * 内側が外れたときに**まだ生きている外側の関門が黙って落ちる**。いまは同時に1画面しか出ないので
 * 到達しないが、単一スロットは将来そこで壊れる（兄弟モジュールが数える形にしたのと同じ理由）。
 */
const guards = new Set<NavigationGuard>();

/**
 * 離れる前に聞きたい間だけ名乗る。`guard` が `null` のときは名乗らない
 * （＝聞く必要が無くなったら外す。外し忘れると、関係ない画面から出られなくなる）。
 */
export function useNavigationGuard(guard: NavigationGuard | null): void {
  // **中身は毎回いちばん新しいものを見る**（関門の関数は描画のたびに作り直されるので、
  // 同一性で購読し直すと毎描画で登録・解除が走る）。名乗り自体はマウント中ずっと1回だけ。
  // ⚠️ ref の書き込みは**描画中ではなく effect の中**で行う（描画中に触ると、更新が届かないことがある）。
  const latest = useRef(guard);
  useEffect(() => {
    latest.current = guard;
  }, [guard]);
  useEffect(() => {
    const entry: NavigationGuard = (to) => (latest.current ? latest.current(to) : true);
    guards.add(entry);
    return () => { guards.delete(entry); }; // 自分が名乗ったものだけを外す
  }, []);
}

/**
 * テスト用：部品を描かずに関門を名乗る（**返る関数を必ず呼んで外す**）。
 * アプリでは使わない＝画面が `useNavigationGuard` で名乗る。
 */
export function registerNavigationGuardForTest(guard: NavigationGuard): () => void {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

/**
 * 遷移してよいか。名乗り手がいなければいつでも通す。
 * **全員が通してよいと言ったときだけ通す**（1つでも断ったら止める＝止めた側が確認を出す）。
 * ⚠️ 断る側でも副作用（確認を出す）が起きるので、**短絡せず全員に聞く**。
 */
export function canNavigate(to: ScreenId): boolean {
  let ok = true;
  for (const g of guards) if (!g(to)) ok = false;
  return ok;
}
