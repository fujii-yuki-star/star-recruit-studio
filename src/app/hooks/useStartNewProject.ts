// 「新しい動画を作る」の共通フロー（破棄ガード付き）。ヘッダ(App)とホームで共有し挙動を統一する（CLAUDE.md §4）。
import { useCallback, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { hasUnsavedChanges } from "./newProjectGuard";

/**
 * 新規作成フロー。**未保存の変更**があるときだけ、いきなり破棄せず確認を挟む（#256・自動保存で保存済みなら確認しない）。
 * 保存済みの内容はディスクに残り「最近のプロジェクト」から開き直せるため、失われるのは未保存分のみ。
 * confirming=true の間は呼び出し側が確認UIを出し、confirm()/cancel() を繋ぐ。確定で newProject→wizard。
 */
export function useStartNewProject(navigate: (screen: ScreenId) => void) {
  const newProject = useProjectStore((s) => s.newProject); // store 型は () => void（同期）
  const hasWork = useProjectStore((s) => hasUnsavedChanges(s.saveStatus, s.scenes.length, s.assets, s.meta));
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
