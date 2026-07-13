import type { ScreenId } from "../data/mockData";
import { useStartNewProject } from "../hooks/useStartNewProject";

/**
 * 「新しい動画を作る」ボタン（破棄ガード付き）。ヘッダ/ホームと**同じ挙動**を空状態（たたき台/場面編集/仕上がり確認）でも使う
 * ため共有する（#413＝同ラベル＝同挙動）。未保存の変更があるときだけ確認を挟み、確定でリセット→ウィザードへ。
 * 確認中はボタンを確認プロンプトに差し替える（EmptyState の action にそのまま置ける）。
 */
export function StartNewVideoButton({ onNavigate }: { onNavigate: (screen: ScreenId) => void }) {
  const { confirming, start, confirm, cancel } = useStartNewProject(onNavigate);
  if (confirming) {
    return (
      <div className="col gap-sm" role="alert">
        <span className="text-sm">
          今の内容を閉じて新しく作りますか？保存していない素材や場面は失われます（保存済みのプロジェクトは一覧からいつでも開けます）。
        </span>
        {/* 確認ダイアログは「やめる（左・ghost）／実行（右）」で全画面統一（#410 sub2・削除確認と同じ並び）。
            画面ごとに順序が違うと「やめるつもりが実行」の誤操作＝データ喪失につながるため。 */}
        <div className="row gap-sm" style={{ justifyContent: "center" }}>
          <button className="btn btn-ghost btn-icon" onClick={cancel}>
            やめる
          </button>
          <button className="btn btn-primary btn-icon" onClick={confirm}>
            新しく作る
          </button>
        </div>
      </div>
    );
  }
  return (
    <button className="btn btn-primary" onClick={start}>
      新しい動画を作る
    </button>
  );
}
