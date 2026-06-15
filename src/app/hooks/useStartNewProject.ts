// 「新しい動画を作る」の共通フロー（破棄ガード付き）。ヘッダ(App)とホームで共有し挙動を統一する（CLAUDE.md §4）。
import { useCallback, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { hasWorkInProgress } from "./newProjectGuard";

/**
 * 新規作成フロー。作業中の内容（場面 or 取り込んだ素材）があるときは、いきなり破棄せず確認を挟む。
 * confirming=true の間は呼び出し側が確認UIを出し、confirm()/cancel() を繋ぐ。確定で newProject→wizard。
 */
export function useStartNewProject(navigate: (screen: ScreenId) => void) {
  const newProject = useProjectStore((s) => s.newProject); // store 型は () => void（同期）
  const hasWork = useProjectStore((s) => hasWorkInProgress(s.scenes.length, s.assets));
  const [confirming, setConfirming] = useState(false);

  const start = useCallback(() => {
    if (hasWork) {
      setConfirming(true);
      return;
    }
    newProject();
    navigate("wizard");
  }, [hasWork, newProject, navigate]);

  const confirm = useCallback(() => {
    setConfirming(false);
    newProject();
    navigate("wizard");
  }, [newProject, navigate]);

  const cancel = useCallback(() => setConfirming(false), []);

  return { confirming, start, confirm, cancel };
}
