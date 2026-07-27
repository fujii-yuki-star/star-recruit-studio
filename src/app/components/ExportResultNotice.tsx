import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { finishedExportNotice, isExportFinished } from "../../domain/export/exportProgress";

/**
 * 書き出しが**終わったことを書き出し画面以外でも知らせる**共通通知（#589）。
 *
 * 書き出し中は他画面へ移動できる設計（`15 §4`）だが、終端になると編集ロックのバナー（`ExportLockBanner`）は
 * **消えるだけ**だった＝離席中に失敗しても「消えた＝成功して終わった」と誤読し、書き出し画面へ戻るまで気づけない。
 *
 * **自分で消える**：`exportRun.resultUnseen` は phase が終端へ入ると立ち、走行/未実行へ戻ると落ちる（store が自動管理）。
 * さらに**書き出し画面を開けば既読**になる（そこに結果が出ているため）＝#547 P3-11 の「古い通知が出続ける」を作らない。
 * 「閉じる」でも消せる（読んだが今は書き出し画面へ行かない、を許す）。
 *
 * 失敗の**理由**は書き出し画面が持つ（`exportRun.message`）ので、ここは種別を言い切って画面へ誘導する（§2-5）。
 */
export function ExportResultNotice({ onNavigate }: { onNavigate: (screen: ScreenId) => void }) {
  // 表示に要る値だけを購読する（exportRun 全体を購読すると進捗更新のたびにシェルごと再描画される）。
  const phase = useProjectStore((s) => s.exportRun.phase);
  const unseen = useProjectStore((s) => s.exportRun.resultUnseen);
  const setExportRun = useProjectStore((s) => s.setExportRun);
  if (!unseen || !isExportFinished(phase)) return null;
  const failed = phase === "error";
  return (
    // 失敗は見落とすと手戻りが大きいので読み上げにも割り込ませる（成功/中止は status）。
    <div
      className={`notice ${failed ? "notice-warn" : "notice-info"} row-between`}
      role={failed ? "alert" : "status"}
      style={{ margin: "var(--gap)" }}
    >
      <span>{finishedExportNotice(phase)}</span>
      <div className="row gap-sm">
        <button className="btn btn-secondary text-sm" onClick={() => onNavigate("export")}>
          書き出しの画面へ
        </button>
        <button className="btn btn-ghost text-sm" onClick={() => setExportRun({ resultUnseen: false })}>
          閉じる
        </button>
      </div>
    </div>
  );
}
