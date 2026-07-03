// 保存の状態を控えめに示すバッジ（#256）。自動保存と手動保存で共有し、要注意の状態だけ出す
// （未保存 / 保存中 / 保存失敗）。保存済み・空の新規状態は何も出さない（保存ボタン側が「保存しました」を表示）。
// 文言は技術用語なし（§2-3）、失敗は「次の行動」を示す（§2-5）。
import { useProjectStore } from "../store/projectStore";
import { hasUnsavedChanges } from "../hooks/newProjectGuard";

export function SaveStatusBadge() {
  const saveStatus = useProjectStore((s) => s.saveStatus);
  const sceneCount = useProjectStore((s) => s.scenes.length);
  const assets = useProjectStore((s) => s.assets);

  if (saveStatus === "saving") {
    return <span className="text-sm text-muted">保存中…</span>;
  }
  if (saveStatus === "error") {
    return (
      <span className="text-sm" role="alert" style={{ color: "var(--color-danger)" }}>
        保存できませんでした（「保存」を押してください）
      </span>
    );
  }
  if (hasUnsavedChanges(saveStatus, sceneCount, assets)) {
    return <span className="text-sm" style={{ color: "#8a6d1a" }}>● 未保存の変更があります</span>;
  }
  return null;
}
