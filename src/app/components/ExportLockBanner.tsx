import type { ReactNode } from "react";
import { isExportBusy, useProjectStore } from "../store/projectStore";

/**
 * 書き出し中は文書（場面・音声・BGM 等）を編集できないことを示す共通バナー（#570 P1・15_ERROR_STATE_MODEL §4・ADR-0026④）。
 * 進行中の書き出しは開始時のスナップショットで進むため、今の編集は「画面/保存は新・MP4 は旧」の不一致になる。
 * store 側でも文書編集アクションを固定しているので、これはその理由を示す表示側（無言 no-op を避ける）。
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

/**
 * 書き出し中は囲んだ編集 UI を実際に操作不可にする（#570 P2 レビュー・ADR-0026④「押せるのに効かない」を無くす）。
 * React 19 の `inert` で**部分木ごと**無効化＝ボタン/入力/ドラッグ/キャンバスまで一括で止まる（フォームだけでなく描画操作も）。
 * ラッパは `display:contents` で**レイアウトに箱を作らない**＝非書き出し時も含めて親の flex/grid/block をそのまま維持する
 * （箱を作らないので opacity 等の見た目変化は載せられない＝操作不可＋理由バナーで伝える）。バナーは inert の**外**に置く（読み上げにも残す）。
 */
export function ExportLock({ children }: { children: ReactNode }) {
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  return (
    <>
      <ExportLockBanner />
      <div inert={isExporting} style={{ display: "contents" }}>
        {children}
      </div>
    </>
  );
}
