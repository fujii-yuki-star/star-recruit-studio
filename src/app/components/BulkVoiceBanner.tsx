import { useProjectStore } from "../store/projectStore";
import { narrationProgress } from "../../domain/voice/narrationProgress";
import { useBulkVoiceControlsCount } from "../hooks/useBulkVoicePresence";
import { BULK_VOICE_CANCEL_LABEL, bulkVoiceRunningNotice } from "../uiLabels";

/**
 * 声をまとめて作っている間、**どの画面にいても**進み具合と中止を出す（#1024 ⑤）。
 *
 * ⚠️ **書き出しは同じ理由で全画面バナーを持っている**（#547 P2-1・`15 §4`）のに、
 * 声の一括作成には効いていなかった＝置いてある3画面（たたき台・場面編集・公開前チェック）を
 * 離れると、**進み具合も中止も見えない**まま「止まった」ように見える（→二重に押す引き金）。
 * ⚠️ **画面に操作が出ている間は出さない**＝同じ進み具合が二重に見える。
 * 判定は**その部品が居るかどうか**で採る（画面の名前で数えない＝上の注記）。
 */
export function BulkVoiceBanner() {
  const generating = useProjectStore((s) => s.isGeneratingNarration);
  const inlineCount = useBulkVoiceControlsCount();
  const scenes = useProjectStore((s) => s.scenes);
  const cancel = useProjectStore((s) => s.cancelNarrationGeneration);
  if (!generating || inlineCount > 0) return null;
  const { done, total } = narrationProgress(scenes);
  return (
    <div className="notice notice-info row-between" role="status" style={{ margin: "var(--gap)" }}>
      <span>{bulkVoiceRunningNotice(done, total)}</span>
      <button className="btn btn-ghost text-sm" onClick={() => cancel()}>
        {BULK_VOICE_CANCEL_LABEL}
      </button>
    </div>
  );
}
