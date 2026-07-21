// 編集中のプロジェクト名を表示・変更する入力（#252）。ヘッダに置き、戻らずにその場で改名できる。
// 確定は blur/Enter（1改名=1履歴＝store.setProjectName）。空・未変更は破棄して元の名前に戻す。技術用語なし（§2-3）。
import { useState } from "react";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { PROJECT_NAME_MAX_LENGTH } from "../../domain/constants";

export function ProjectNameField() {
  const projectName = useProjectStore((s) => s.meta.projectName);
  const setProjectName = useProjectStore((s) => s.setProjectName);
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase)); // 書き出し中は改名を止める（#570 P2）
  const [draft, setDraft] = useState<string | null>(null); // null＝非編集（store の名前を表示）

  const commit = () => {
    if (draft != null) {
      const name = draft.trim();
      if (name && name !== projectName) setProjectName(name); // 空・未変更は保存しない
    }
    setDraft(null);
  };

  return (
    <input
      className="input"
      value={draft ?? projectName}
      placeholder="無題のプロジェクト"
      aria-label="動画の名前"
      title="動画の名前（ここで変えられます）"
      maxLength={PROJECT_NAME_MAX_LENGTH} // schema の projectName 上限（1–80字）に合わせる（貼り付け等での超過を UI で予防・#411）
      disabled={isExporting}
      onFocus={() => setDraft(projectName)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // 日本語IMEの変換確定 Enter では確定（blur）しない（HomeScreen/FreeLayoutOverlay と同じガード・レビュー対応）。
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      style={{ fontWeight: 600, maxWidth: 320, minWidth: 120 }}
    />
  );
}
