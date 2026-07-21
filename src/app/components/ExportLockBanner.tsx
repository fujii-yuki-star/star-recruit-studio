import { isExportBusy, useProjectStore } from "../store/projectStore";

/**
 * 書き出し中は文書（場面・音声・BGM 等）を編集できないことを示す共通バナー（#570 P1・15_ERROR_STATE_MODEL §4・ADR-0026④）。
 * 進行中の書き出しは開始時のスナップショットで進むため、今の編集は「画面/保存は新・MP4 は旧」の不一致になる。
 * store 側でも文書編集アクションを固定しているので、これはその理由を示す表示側（無言 no-op を避ける）。
 * 文書を編集できる画面（場面編集・たたき台・仕上がり確認・タイムライン）の先頭に置く。
 */
export function ExportLockBanner() {
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  if (!isExporting) return null;
  return (
    <div className="notice notice-info mb" role="status">
      書き出し中は編集できません。書き出しが終わってからお試しください。
    </div>
  );
}
