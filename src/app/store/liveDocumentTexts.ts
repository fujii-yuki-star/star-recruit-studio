// 開いている動画について、**画面が持っている内容**を JSON の文字列で返す（ADR-0064 決定2）。
//
// ⚠️ **保存前の変更と、取り消し／やり直しの履歴も含める**＝ディスクの文書だけを見て片づけると、
// まだ保存していない取り込みや、やり直しで戻せる止めた絵のファイルを「使っていない」と取り違える。
// ⚠️ **形は問わない**＝受け側（Rust）は文書の中の全部の文字列を見るので、欄を選んで渡さない。
import { NARRATION_STATUS } from "../../domain/enums";
import { isExportBusy, useProjectStore } from "./projectStore";
import { isTimelineExportBusy, useTimelineStore } from "./timelineStore";

export function liveDocumentTexts(projectId: string): string[] {
  const out: string[] = [];
  const p = useProjectStore.getState();
  if (p.meta.projectId === projectId) {
    out.push(JSON.stringify({ meta: p.meta, assets: p.assets, parts: p.parts, scenes: p.scenes, past: p.past, future: p.future }));
  }
  const t = useTimelineStore.getState();
  if (t.doc?.projectId === projectId) {
    out.push(JSON.stringify({ doc: t.doc, history: t.history }));
  }
  return out;
}

/**
 * いま片づけてよいか（その動画で取り込み・書き出し・声づくりが走っていないか）。
 * ⚠️ **走っている間は断る**＝書きかけのファイルは、まだどの文書にも書かれていない。
 */
export function cleanupBusy(projectId: string): boolean {
  const p = useProjectStore.getState();
  // ⚠️ **1場面だけの声づくりも見る**（PR #1472 レビュー ℹ️）＝一括の印（`isGeneratingNarration`）は立たず、
  //   場面・行の状態が「準備中」になるだけ。
  const sceneVoicePending = p.scenes.some(
    (s) => s.narration.status === NARRATION_STATUS.pending || (s.lines ?? []).some((l) => l.status === NARRATION_STATUS.pending),
  );
  if (p.meta.projectId === projectId && (p.isImporting || p.isGeneratingNarration || sceneVoicePending || isExportBusy(p.exportRun.phase))) return true;
  const t = useTimelineStore.getState();
  return t.doc?.projectId === projectId && (t.isImporting || t.generatingVoiceClipId != null || isTimelineExportBusy(t.exportRun.phase));
}
