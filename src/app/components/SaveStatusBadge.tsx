// 保存の状態を控えめに示すバッジ（#256）。自動保存と手動保存で共有し、要注意の状態だけ出す
// （未保存 / 保存中 / 保存失敗）。保存済み・空の新規状態は何も出さない（保存ボタン側が「保存しました」を表示）。
// 文言は技術用語なし（§2-3）、失敗は「次の行動」を示す（§2-5）。
import { useProjectStore } from "../store/projectStore";
import { hasUnsavedChanges } from "../hooks/newProjectGuard";

// 未保存インジケータの単一実装（#410 sub6）。プロジェクト保存（SaveStatusBadge）とテンプレ編集
// （LooksEditScreen＝テンプレ下書きの dirty）で状態の出どころは違うが、見た目・文言はこれ1つに揃える。
export function UnsavedMark() {
  return <span className="text-sm" style={{ color: "#8a6d1a" }}>● 未保存の変更があります</span>;
}

export function SaveStatusBadge() {
  const saveStatus = useProjectStore((s) => s.saveStatus);
  const sceneCount = useProjectStore((s) => s.scenes.length);
  const assets = useProjectStore((s) => s.assets);
  const meta = useProjectStore((s) => s.meta); // ウィザード入力も「未保存の変更」に含める（#401）

  if (saveStatus === "saving") {
    return <span className="text-sm text-muted">保存中…</span>;
  }
  if (saveStatus === "error") {
    // 実際の保存ボタンは「保存に失敗（もう一度押す）」表示。バッジの案内も同じ行動へ揃える（存在しない「保存」ラベルを指さない・§2-5）。
    return (
      <span className="text-sm" role="alert" style={{ color: "var(--color-danger)" }}>
        保存できませんでした（もう一度お試しください）
      </span>
    );
  }
  if (hasUnsavedChanges(saveStatus, sceneCount, assets, meta)) {
    return <UnsavedMark />;
  }
  return null;
}
