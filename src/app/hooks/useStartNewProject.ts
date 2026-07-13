// 「新しい動画を作る」の共通フロー（破棄ガード付き）。ヘッダ(App)とホームで共有し挙動を統一する（CLAUDE.md §4）。
// ウィザード（AI 生成前提）と「白紙から作る」（#393・AI/ウィザードを通らない）の2経路を、同じ破棄ガードで扱う。
import { useCallback, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { hasUnsavedChanges } from "./newProjectGuard";

// 新規作成の行き先。wizard＝従来（AI 生成前提）／blank＝白紙から手動で組む（#393）。
type NewProjectKind = "wizard" | "blank";

/**
 * 新規作成フロー。**未保存の変更**があるときだけ、いきなり破棄せず確認を挟む（#256・自動保存で保存済みなら確認しない）。
 * 保存済みの内容はディスクに残り「最近のプロジェクト」から開き直せるため、失われるのは未保存分のみ。
 * confirming=true の間は呼び出し側が確認UIを出し、confirm()/cancel() を繋ぐ。確定で「保留していた行き先」を実行する
 *（start＝ウィザード／startBlank＝白紙。どちらも同じ確認UIを共有し、confirm() が最後に選んだ経路を実行する）。
 */
export function useStartNewProject(navigate: (screen: ScreenId) => void) {
  const newProject = useProjectStore((s) => s.newProject); // store 型は () => void（同期）
  const newBlankProject = useProjectStore((s) => s.newBlankProject);
  const hasWork = useProjectStore((s) => hasUnsavedChanges(s.saveStatus, s.scenes.length, s.assets, s.meta));
  // 確認中に「どの経路を確定するか」を保持する（null＝確認していない）。
  const [pending, setPending] = useState<NewProjectKind | null>(null);

  const run = useCallback(
    (kind: NewProjectKind) => {
      if (kind === "blank") {
        newBlankProject();
        navigate("draft"); // 白紙はたたき台へ（ウィザードを通らない）。空状態から「場面を追加」で組む。
      } else {
        newProject();
        navigate("wizard");
      }
    },
    [newProject, newBlankProject, navigate],
  );

  // 破棄ガード：未保存があれば確認、無ければ即実行。
  const begin = useCallback(
    (kind: NewProjectKind) => {
      if (hasWork) {
        setPending(kind);
        return;
      }
      run(kind);
    },
    [hasWork, run],
  );

  const start = useCallback(() => begin("wizard"), [begin]);
  const startBlank = useCallback(() => begin("blank"), [begin]);
  const confirm = useCallback(() => {
    const kind = pending;
    setPending(null);
    if (kind) run(kind);
  }, [pending, run]);
  const cancel = useCallback(() => setPending(null), []);

  return { confirming: pending !== null, start, startBlank, confirm, cancel };
}
