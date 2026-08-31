// 編集が落ち着いたら自動でバックグラウンド保存する（#256・作業を失わない安全網）。
// 「保存待ち（idle）＋失うと困る内容あり」のとき、一定秒の無操作後に saveProject を呼ぶ（デバウンス）。
// 保存中（saving）は多重起動しない（store の saveProject 側でもガード）。保存失敗（error）は自動再試行せず、
// 次の編集で idle に戻れば再開する（失敗ループを避ける／手動保存でも復帰可）。App で1回だけ呼ぶ。
import { useEffect } from "react";
import { useProjectStore } from "../store/projectStore";
import { hasWorkInProgress } from "../newProjectGuard";

/** 最後の操作から自動保存までの待ち（ms）。編集が続く間はリセットし、落ち着いてから1回走らせる。 */
export const AUTOSAVE_DEBOUNCE_MS = 3000;

export function useAutoSave(): void {
  const saveStatus = useProjectStore((s) => s.saveStatus);
  const sceneCount = useProjectStore((s) => s.scenes.length);
  const assets = useProjectStore((s) => s.assets);
  const meta = useProjectStore((s) => s.meta); // ウィザード入力（会社名/テーマ）も自動保存の対象に含める（#401）
  const editSeq = useProjectStore((s) => s.past.length); // 編集ごとに増える＝操作の合図（デバウンス再開に使う）
  const historyDepth = useProjectStore((s) => s._historyGroupDepth); // >0＝連続操作（ドラッグ等）の最中
  const saveProject = useProjectStore((s) => s.saveProject);

  useEffect(() => {
    // idle（＝直近の編集で未保存）かつ内容があるときだけ自動保存。error は自動再試行しない・saving は多重起動しない。
    // 連続操作（ドラッグ＝履歴グループ）の最中は保留し、endHistoryGroup で depth が 0 に戻ってからデバウンス開始する
    // （グループ中は pushHistory が no-op で editSeq が動かず、長いドラッグの途中で保存が挟まるのを防ぐ・#256 レビュー🟡）。
    if (saveStatus !== "idle" || historyDepth > 0 || !hasWorkInProgress(sceneCount, assets, meta)) return;
    const timer = window.setTimeout(() => {
      void saveProject();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [saveStatus, editSeq, historyDepth, sceneCount, assets, meta, saveProject]);
}
