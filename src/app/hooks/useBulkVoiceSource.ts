// 「声をまとめて作る」の**出どころ**（#1019 ⑥）。場面形式とタイムライン形式で1つの部品を使うための口。
//
// ⚠️ **バラバラに渡さない**（#1034 で踏んだ形）＝進み具合・作成中・中止をそれぞれ props で渡すと、
// **型は合うまま別の形式のものが混ざる**（実際に取り込みの中止でそれをやった）。
// **1つの物を受け取って、部品が中身を取り出す**形にする。
//
// ⚠️ **2つの実装を同じファイルに並べる**＝片方だけ直した、が目で見て分かるようにするため。
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { isTimelineExportBusy, useTimelineStore } from "../store/timelineStore";
import { narrationProgress } from "../../domain/voice/narrationProgress";
import { sceneNeedsVoice } from "../../domain/project/narrationLines";
import { timelineVoiceProgress, voiceClipNeedsVoice } from "../../domain/timeline/voice";

/** どちらの形式のまとめて作るか（バナーが形式ごとに数えるための鍵）。 */
export type BulkVoiceFormat = "scene" | "timeline";

/** まとめて作るのに要るものひと揃い。 */
export interface BulkVoiceSource {
  /** どちらの形式か（バナー・数え方の鍵）。 */
  format: BulkVoiceFormat;
  /**
   * セリフを置く単位の呼び名（押せない理由の文言に差し込む）。
   *
   * ⚠️ **「場面」と決め打たない**＝タイムライン形式に**場面は無い**（`06 §12.1` 決定5）。
   * ボタンの文言だけ分けても**押せない理由に分岐が漏れる**と、#991 ① がそのまま再発する
   * （PR #1044 レビュー 🔴＝実際に漏れていた）。
   */
  unitLabel: string;
  /** 作成済み / 文のある読み上げ。 */
  progress: { done: number; total: number };
  /** いままとめて作っている最中か。 */
  generating: boolean;
  /** 直前のまとめて作るのを中止したか（案内の出し分け）。 */
  cancelled: boolean;
  /** まだ作っていない読み上げがあるか（無ければ押せない）。 */
  needsWork: boolean;
  /** 書き出し中か（作れても文書へ入れられないので押せない）。 */
  isExporting: boolean;
  generateAll: () => Promise<void>;
  cancel: () => void;
  /** 走り終えたあとに中止だったかを読む（`onFinished` に渡す）。 */
  wasCancelled: () => boolean;
}

/** 場面形式（たたき台・場面編集・公開前チェック）。 */
export function useSceneBulkVoice(): BulkVoiceSource {
  const scenes = useProjectStore((s) => s.scenes);
  const generating = useProjectStore((s) => s.isGeneratingNarration);
  const cancelled = useProjectStore((s) => s.narrationCancelled);
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  const generateAll = useProjectStore((s) => s.generateAllNarrations);
  const cancel = useProjectStore((s) => s.cancelNarrationGeneration);
  return {
    format: "scene",
    unitLabel: "場面",
    progress: narrationProgress(scenes),
    generating,
    cancelled,
    // 対象の判定は store と共有＝「押せるのに何も起きない」を作らない（ADR-0026④）。
    needsWork: scenes.some(sceneNeedsVoice),
    isExporting,
    generateAll,
    cancel,
    wasCancelled: () => useProjectStore.getState().narrationCancelled,
  };
}

/** タイムライン形式（タイムライン編集）。 */
export function useTimelineBulkVoice(): BulkVoiceSource {
  const clips = useTimelineStore((s) => s.doc?.clips);
  const generating = useTimelineStore((s) => s.isGeneratingVoices);
  const cancelled = useTimelineStore((s) => s.voicesCancelled);
  const isExporting = useTimelineStore((s) => isTimelineExportBusy(s.exportRun.phase));
  const generateAll = useTimelineStore((s) => s.generateAllVoices);
  const cancel = useTimelineStore((s) => s.cancelVoiceGeneration);
  const list = clips ?? [];
  return {
    format: "timeline",
    // ⚠️ タイムライン形式に「場面」は無い＝セリフは**読み上げの部品**に入る。
    unitLabel: "読み上げ",
    progress: timelineVoiceProgress(list),
    generating,
    cancelled,
    needsWork: list.some(voiceClipNeedsVoice),
    isExporting,
    generateAll,
    cancel,
    wasCancelled: () => useTimelineStore.getState().voicesCancelled,
  };
}
