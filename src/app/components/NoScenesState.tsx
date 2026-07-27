import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { EmptyState } from "./states";
import { StartNewVideoButton } from "./StartNewVideoButton";
import { ChevronRightIcon, PlusIcon } from "./icons";
import { GO_TO_DRAFT_LABEL, noScenesMessage, noScenesTitle, RETRY_GENERATE_LABEL, START_MANUAL_LABEL } from "../uiLabels";

/**
 * 「場面がまだ1つも無い」ときの表示（#590）。**公開前チェック／仕上がり確認／書き出し／たたき台**が共有する。
 *
 * 以前は画面ごとの手書きで、3点が揃っていなかった：
 *  - **見た目**：公開前チェックだけ共有の `EmptyState` を使っていなかった。
 *  - **次の行動**：同じ「場面が無い」なのに、たたき台へ行く画面と**今の動画を捨てて作り直す**画面があった
 *    （0件なら捨てて困るものは無いが、素材・会社情報は残っているので「作り直す」は行き過ぎ）。
 *  - **状態**：たたき台だけが `status` を見て文言を変え、他は0件しか見ていなかった＝**生成に失敗しても
 *    「まだ場面がありません」**としか出ず、理由も次の行動も分からなかった（§2-5）。
 *
 * 状態の見分けと次の行動をここ1か所に集約する（ADR-0026②：同じ状況なら同じ挙動）。
 *
 * @param purpose その画面で何ができるようになるか（例「仕上がりを確認できます」）。文言に差し込む。
 * @param onAddScene **その画面自身が場面を作れる**とき渡す（たたき台のみ）。渡すと「場面を追加」を出し、
 *                   渡さない画面は「たたき台へ」＝場面を作れる画面へ送る（自分の画面へ送り返さない）。
 */
export function NoScenesState({ purpose, onNavigate, onAddScene }: {
  purpose: string;
  onNavigate: (screen: ScreenId) => void;
  onAddScene?: () => void;
}) {
  const status = useProjectStore((s) => s.status);
  const aiError = useProjectStore((s) => s.aiError);
  const startManualEdit = useProjectStore((s) => s.startManualEdit);
  const canAddScene = onAddScene != null;

  const toDraft = (
    <button className="btn btn-primary btn-icon" onClick={() => onNavigate("draft")}>
      {GO_TO_DRAFT_LABEL}
      <ChevronRightIcon size={18} />
    </button>
  );

  // 状態ごとの「次の行動」。作成中は待つだけなので、場面を作れない画面からはたたき台へ送るに留める。
  const action =
    status === "error" ? (
      // 生成中画面の2択（#393 P1）と同じ＝どの画面から見ても復帰の仕方が変わらない。ラベルも共有する（§6）。
      // 再試行は生成中画面へ送る（そこが作成の進捗・中止の持ち主）。
      <div className="row gap-sm" style={{ justifyContent: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={() => onNavigate("generating")}>{RETRY_GENERATE_LABEL}</button>
        <button className="btn btn-secondary" onClick={() => { startManualEdit(); onNavigate("draft"); }}>
          {START_MANUAL_LABEL}
        </button>
      </div>
    ) : status === "idle" ? (
      <StartNewVideoButton onNavigate={onNavigate} />
    ) : status === "generating" ? (
      // たたき台は自分自身なので送り先が無く、作りかけの動画案に場面を足させるのも避けたい＝待たせる（唯一ボタン無し）。
      canAddScene ? undefined : toDraft
    ) : canAddScene ? (
      <button className="btn btn-primary" onClick={onAddScene}>
        <PlusIcon size={18} />
        場面を追加
      </button>
    ) : (
      toDraft
    );

  return (
    <EmptyState
      title={noScenesTitle(status, canAddScene)}
      message={noScenesMessage(status, canAddScene, purpose, aiError)}
      action={action}
    />
  );
}
