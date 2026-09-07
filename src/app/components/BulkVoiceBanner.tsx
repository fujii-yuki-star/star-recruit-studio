import { useBulkVoiceControlsCount } from "../hooks/useBulkVoicePresence";
import { useSceneBulkVoice, useTimelineBulkVoice, type BulkVoiceSource } from "../hooks/useBulkVoiceSource";
import { BULK_VOICE_CANCEL_LABEL, bulkVoiceRunningNotice } from "../uiLabels";

/**
 * 声をまとめて作っている間、**どの画面にいても**進み具合と中止を出す（#1024 ⑤）。
 *
 * ⚠️ **書き出しは同じ理由で全画面バナーを持っている**（#547 P2-1・`15 §4`）のに、
 * 声の一括作成には効いていなかった＝置いてある画面を離れると、**進み具合も中止も見えない**まま
 * 「止まった」ように見える（→二重に押す引き金）。
 * ⚠️ **画面に操作が出ている間は出さない**＝同じ進み具合が二重に見える。
 * 判定は**その部品が居るかどうか**で採る（画面の名前で数えない）。
 *
 * ⚠️ **両方の形式を見る**（#1019 ⑥・PR #1044 レビュー）＝タイムライン形式にも一括作成ができた以上、
 * `06 §9.0.1`（**どの画面にいても**進み具合と中止を出す）は**そちらにも及ぶ**。
 * 見ていなかった間は、「読み上げを置く」の欄を閉じただけで**走っているのにどこにも出ない**＝
 * #1024 ⑤ が直した症状がそのまま再発していた。
 * ⚠️ **2つの形式は同時に開いたままが正規の状態**なので、**同時に走りうる**＝
 * 走っているぶんだけ並べる（片方の操作が出ているせいで、もう片方まで引っ込めない）。
 */
export function BulkVoiceBanner() {
  const scene = useSceneBulkVoice();
  const timeline = useTimelineBulkVoice();
  const sceneInline = useBulkVoiceControlsCount("scene");
  const timelineInline = useBulkVoiceControlsCount("timeline");
  const rows = [
    { source: scene, inline: sceneInline },
    { source: timeline, inline: timelineInline },
  ].filter((r) => r.source.generating && r.inline === 0);
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map(({ source }) => (
        <BulkVoiceRow key={source.format} source={source} />
      ))}
    </>
  );
}

function BulkVoiceRow({ source }: { source: BulkVoiceSource }) {
  const { done, total } = source.progress;
  return (
    <div className="notice notice-info row-between" role="status" style={{ margin: "var(--gap)" }}>
      <span>{bulkVoiceRunningNotice(done, total)}</span>
      <button className="btn btn-ghost text-sm" onClick={() => source.cancel()}>
        {BULK_VOICE_CANCEL_LABEL}
      </button>
    </div>
  );
}
