// 編集が落ち着いたら自動でバックグラウンド保存する（#256・作業を失わない安全網）。
// 「保存待ち（idle）＋失うと困る内容あり」のとき、一定秒の無操作後に saveProject を呼ぶ（デバウンス）。
// 保存中（saving）は多重起動しない（store の saveProject 側でもガード）。保存失敗（error）は自動再試行せず、
// 次の編集で idle に戻れば再開する（失敗ループを避ける／手動保存でも復帰可）。App で1回だけ呼ぶ。
import { useEffect } from "react";
import { useProjectStore } from "../store/projectStore";
import { hasWorkInProgress } from "./newProjectGuard";

/** 最後の操作から自動保存までの待ち（ms）。編集が続く間はリセットし、落ち着いてから1回走らせる。 */
export const AUTOSAVE_DEBOUNCE_MS = 3000;

export function useAutoSave(): void {
  const saveStatus = useProjectStore((s) => s.saveStatus);
  const sceneCount = useProjectStore((s) => s.scenes.length);
  const assets = useProjectStore((s) => s.assets);
  const editSeq = useProjectStore((s) => s.past.length); // 編集ごとに増える＝操作の合図（デバウンス再開に使う）
  const saveProject = useProjectStore((s) => s.saveProject);

  useEffect(() => {
    // idle（＝直近の編集で未保存）かつ内容があるときだけ自動保存。error は自動再試行しない・saving は多重起動しない。
    if (saveStatus !== "idle" || !hasWorkInProgress(sceneCount, assets)) return;
    const timer = window.setTimeout(() => {
      void saveProject();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [saveStatus, editSeq, sceneCount, assets, saveProject]);
}
