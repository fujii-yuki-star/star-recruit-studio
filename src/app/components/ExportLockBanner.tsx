import type { ReactNode } from "react";
import type { ScreenId } from "../data/mockData";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { ArrowLeftIcon } from "./icons";
import { exportOverallPercent, exportProgressLabel, hasExportPercent } from "../../domain/export/exportProgress";

/**
 * 書き出し中は文書（場面・音声・BGM 等）を編集できないことを示す共通バナー（#570 P1・15_ERROR_STATE_MODEL §4・ADR-0026④）。
 * 進行中の書き出しは開始時のスナップショットで進むため、今の編集は「画面/保存は新・MP4 は旧」の不一致になる。
 * store 側でも文書編集アクションを固定しているので、これはその理由を示す表示側（無言 no-op を避ける）。
 *
 * 進捗（%＋いま何をしているか）と書き出し画面へ戻る導線も出す（#547 P2-1）。書き出し中も他の画面へ移動できるのに
 * 進捗が書き出し画面にしか無いと、離れた利用者には**止まったように見える**（→二重書き出しの引き金）。数字と説明は
 * 書き出し画面と同じ純粋関数から作る＝画面を移っても同じ進捗が見える（§2-7・ADR-0026②）。
 *
 * `onNavigate` は**必須**：渡し忘れると導線が静かに消える（どの画面から書き出しへ戻れるかが実装差になる・ADR-0026②）。
 * `detail` はその画面で何ができなくなるかの補足（既定は編集ロックの案内）。
 */
export function ExportLockBanner({ onNavigate, detail }: { onNavigate: (screen: ScreenId) => void; detail?: string }) {
  // 表示する値だけを購読する（exportRun 全体を購読すると、1フレームごとの進捗更新でこのバナーを持つ画面が丸ごと再描画される）。
  const busy = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  const hasPercent = useProjectStore((s) => hasExportPercent(s.exportRun.phase));
  const percent = useProjectStore((s) => (isExportBusy(s.exportRun.phase) ? exportOverallPercent(s.exportRun) : 0));
  // 1文に括弧で差し込むので compact（句点で終わる完結文にしない＝文の中に文が入れ子にならない）。
  const label = useProjectStore((s) => (isExportBusy(s.exportRun.phase) ? exportProgressLabel(s.exportRun, { compact: true }) : ""));
  if (!busy) return null;
  return (
    <div className="notice notice-info mb row-between" role="status">
      <span>
        {/* ⚠️ **言えない段に数を出さない**（#993 ①・PR #1025 レビュー 🟡）＝始めた段
            （保存先を選んでもらう／場面ぜんぶの下ごしらえ）は**進み具合を持っていない**ので、
            0% と出すと「止まっている」に見える。画面の進捗欄と**同じ判定**から出し分ける。 */}
        {hasPercent
          ? `動画を書き出し中です（${percent}%${label ? `・${label}` : ""}）。`
          : "動画の書き出しを始めています。"}
        {/* 「〜できません」を必ず言う：`ExportLock` を使わない画面（ウィザード等）は入力欄が生きたままで、
            この文だけが「入れても保存されない」を伝える唯一の手段になる（§2-5・ADR-0026④）。
            兄弟の案内（EXPORT_BUSY_ASSET_MSG 等・standardLookButtonReason）とも同じ型にそろえる。 */}
        {detail ?? "書き出しが終わるまで編集できません。"}
        {/* 待つ以外の「次の行動」も示す＝中止は編集ロックの唯一の抜け道（15 §2.3/§4）。 */}
        急ぐときは書き出しの画面で中止できます。
      </span>
      <button className="btn btn-ghost btn-icon text-sm" onClick={() => onNavigate("export")}>
        <ArrowLeftIcon size={16} />
        書き出しへ戻る
      </button>
    </div>
  );
}

/**
 * 書き出し中は囲んだ編集 UI を実際に操作不可にする（#570 P2 レビュー・ADR-0026④「押せるのに効かない」を無くす）。
 * React 19 の `inert` で**部分木ごと**無効化＝ボタン/入力/ドラッグ/キャンバスまで一括で止まる（フォームだけでなく描画操作も）。
 * ラッパは `display:contents` で**レイアウトに箱を作らない**＝非書き出し時も含めて親の flex/grid/block をそのまま維持する
 * （箱を作らないので opacity 等の見た目変化は載せられない＝操作不可＋理由バナーで伝える）。バナーは inert の**外**に置く
 * （読み上げにも残す／「書き出しの画面へ」を押せるようにする＝#547 P2-1）。
 */
export function ExportLock({ children, onNavigate }: { children: ReactNode; onNavigate: (screen: ScreenId) => void }) {
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  return (
    <>
      <ExportLockBanner onNavigate={onNavigate} />
      <div inert={isExporting} style={{ display: "contents" }}>
        {children}
      </div>
    </>
  );
}
