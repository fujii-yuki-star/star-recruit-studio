// 「新しい動画を作る」の共通フロー（破棄ガード付き）。ヘッダ(App)とホームで共有し挙動を統一する（CLAUDE.md §4）。
// ウィザード（AI 生成前提）と「白紙から作る」（#393・AI/ウィザードを通らない）に加え、
// **タイムラインで作る**（#635・ADR-0032 決定7/15＝別形式の完全新規）を、同じ破棄ガードで扱う。
import { useCallback, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";
import { hasUnsavedChanges } from "./newProjectGuard";

// 新規作成の行き先。wizard＝従来（AI 生成前提）／blank＝白紙から手動で組む（#393）。
type NewProjectKind = "wizard" | "blank" | "timeline";

/** 新しいタイムラインプロジェクトの既定の名前（利用者はあとで変えられる）。 */
export const NEW_TIMELINE_PROJECT_NAME = "新しいタイムライン";

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
  // タイムライン形式の新規作成はディスクへ書くので、作っている間と失敗を画面へ出す（§2-5）。
  const [creating, setCreating] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const createTimelineProject = useTimelineStore((s) => s.createTimelineProject);

  const run = useCallback(
    (kind: NewProjectKind) => {
      if (kind === "timeline") {
        // タイムライン形式は**別の文書**＝場面形式の store は触らず、作って開く（ADR-0032 決定7/15）。
        // 作れなかったときは黙って画面を変えず、その場に理由を出す（§2-5）。
        setCreateFailed(false);
        setCreating(true);
        void createTimelineProject(NEW_TIMELINE_PROJECT_NAME)
          .then(() => {
            navigate("timeline-project");
          })
          .catch((e) => {
            console.warn("[timeline] 新規作成に失敗:", e);
            setCreateFailed(true);
          })
          .finally(() => setCreating(false));
        return;
      }
      if (kind === "blank") {
        newBlankProject();
        navigate("draft"); // 白紙はたたき台へ（ウィザードを通らない）。空状態から「場面を追加」で組む。
      } else {
        newProject();
        navigate("wizard");
      }
    },
    [newProject, newBlankProject, createTimelineProject, navigate],
  );

  // 破棄ガード：未保存があれば確認、無ければ即実行。
  const begin = useCallback(
    (kind: NewProjectKind) => {
      // タイムライン形式は**別の文書**を作るだけ＝場面形式の作業は失われない。ここで
      // 「保存していない素材や場面は失われます」と聞くと、**しないことを言う**ことになる（ADR-0026①）。
      if (kind === "timeline") {
        run(kind);
        return;
      }
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
  const startTimeline = useCallback(() => begin("timeline"), [begin]);
  const confirm = useCallback(() => {
    const kind = pending;
    setPending(null);
    if (kind) run(kind);
  }, [pending, run]);
  const cancel = useCallback(() => setPending(null), []);

  return { confirming: pending !== null, start, startBlank, startTimeline, creating, createFailed, confirm, cancel };
}
