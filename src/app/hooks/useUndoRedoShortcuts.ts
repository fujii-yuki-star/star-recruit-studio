// Undo/Redo のキーボード入口（ADR-0020・#211/#255/#413/#547 P1-1）。Ctrl/⌘+Z＝取り消し・Ctrl/⌘+Shift+Z／Ctrl+Y＝やり直し。
// テキスト入力中（input/textarea/contentEditable）は標準の文字 Undo に任せ、ここでは奪わない。
// App 一箇所で登録する（画面ごとの二重登録＝二重 Undo を防ぐ・#413）が、**有効にする画面は enabled で絞る**（下記）。
import { useEffect } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";

/**
 * Ctrl/⌘+Z・Y を有効にする画面（#413 の「全画面」から #547 P1-1 で限定・ADR-0020「入口」）。
 *
 * 条件＝**画面に「取り消す/やり直す」UI がある画面**（たたき台・場面編集・タイムライン編集）だけ
 * ＝Undo の結果がその画面で見えて確認できる。ボタンとキーボードの入口を一致させる（ADR-0026②）。
 *
 * 全画面で有効にすると、編集を**画面ローカル state** で持つ画面（テンプレ作成＝`LooksEditScreen` の `draft`）で
 * Ctrl+Z が**画面外の場面/メタ編集を無言で巻き戻し**、`undo` が立てる `saveStatus:"idle"` を見た自動保存が
 * その巻き戻しを**永続化**してしまう（#547 P1-1・データ喪失・ADR-0026④）。
 *
 * ※ 除外画面にも履歴 slice を触る操作はある（声/BGM/ウィザード入力＝`updateVoiceSettings`/`setBundledBgm`/
 *   `applyProjectInfo` は pushHistory する）が、**その画面に取り消す/やり直すUIが無い**＝結果を確認できないため
 *   対象外（多くはテキスト入力＝下の入力欄ガードで元々効かない）。素材は履歴対象外（ADR-0020）。
 * ※ #413 の「たたき台の削除/移動も Ctrl+Z で戻せるように」という意図は `draft` を含めることで満たす。
 */
export const UNDO_REDO_SCREENS: ReadonlySet<ScreenId> = new Set<ScreenId>(["draft", "scene-edit", "timeline-edit"]);

/** @param enabled この画面で Ctrl/⌘+Z・Y を有効にするか（App から `UNDO_REDO_SCREENS.has(screen)` を渡す）。 */
export function useUndoRedoShortcuts(enabled: boolean): void {
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  useEffect(() => {
    if (!enabled) return; // 対象外の画面では購読しない＝画面外の編集を無言で巻き戻さない（#547 P1-1）
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, undo, redo]);
}
