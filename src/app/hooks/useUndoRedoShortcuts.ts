// Undo/Redo のキーボード入口（ADR-0020・#211/#255/#413/#547 P1-1）。Ctrl/⌘+Z＝取り消し・Ctrl/⌘+Shift+Z／Ctrl+Y＝やり直し。
// テキスト入力中（input/textarea/contentEditable）は標準の文字 Undo に任せ、ここでは奪わない。
// App 一箇所で登録する（画面ごとの二重登録＝二重 Undo を防ぐ・#413）が、**有効にする画面は enabled で絞る**（下記）。
import { useEffect } from "react";
import { shouldIgnoreShortcut } from "./keyboardShortcut";
import type { ScreenId } from "../data/mockData";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import type { ExportPhase } from "../store/projectStore";

/**
 * Ctrl/⌘+Z・Y を有効にする画面（#413 の「全画面」から #547 P1-1 で限定・ADR-0020「入口」）。
 *
 * 条件＝**store 履歴（meta/parts/scenes）をその画面で編集している画面**（たたき台・場面編集・タイムライン編集）だけ
 * ＝Undo の結果がその画面で見えて確認できる。ボタンとキーボードの入口を一致させる（ADR-0026②）。
 *
 * ※ ここは **store 履歴の入口**の集合。「取り消す/やり直すUIがある画面」とは一致しない：テンプレ作成
 *   （`LooksEditScreen`）も #547 P2-3 で取り消す/やり直すを持つが、戻す対象は**画面ローカル下書き**で
 *   （`useDraftHistory`）、store 履歴には触れない＝この集合には**入れない**（入れると下記のデータ喪失が起きる）。
 *
 * 全画面で有効にすると、編集を**画面ローカル state** で持つ画面（テンプレ作成＝`LooksEditScreen` の `draft`）で
 * Ctrl+Z が**画面外の場面/メタ編集を無言で巻き戻し**、`undo` が立てる `saveStatus:"idle"` を見た自動保存が
 * その巻き戻しを**永続化**してしまう（#547 P1-1・データ喪失・ADR-0026④）。
 *
 * ※ 除外画面にも履歴 slice を触る操作はある（声/BGM/ウィザード入力＝`updateVoiceSettings`/`setBundledBgm`/
 *   `applyProjectInfo` は pushHistory する）が、**その画面で store 履歴を編集しているとは言えず**取り消す/やり直すUI も
 *   無い＝結果を確認できないため対象外（多くはテキスト入力＝下の入力欄ガードで元々効かない）。素材は履歴対象外（ADR-0020）。
 * ※ #413 の「たたき台の削除/移動も Ctrl+Z で戻せるように」という意図は `draft` を含めることで満たす。
 */
export const UNDO_REDO_SCREENS: ReadonlySet<ScreenId> = new Set<ScreenId>(["draft", "scene-edit"]);

/**
 * App のキーボード Undo/Redo 結線を1つの純粋述語に集約する（#570 P2 レビュー）。
 * 「取り消す/やり直すUIのある画面（{@link UNDO_REDO_SCREENS}）」かつ「書き出し中でない」ときだけ有効
 * ＝キー入口をボタンの活性状態に一致させる（書き出し中はボタンが inert なのにキーだけ効く不整合を防ぐ・ADR-0026②/④）。
 * App も回帰テストも**同じこの関数**を参照し、結線のドリフト（`&&` の欠落・参照画面/フェーズの取り違え）を1箇所で検知する。
 */
export function isUndoRedoEnabledFor(screen: ScreenId, exportPhase: ExportPhase): boolean {
  return UNDO_REDO_SCREENS.has(screen) && !isExportBusy(exportPhase);
}

/**
 * @param enabled この画面で Ctrl/⌘+Z・Y を有効にするか（App から {@link isUndoRedoEnabledFor} を渡す）。
 * @param handlers 取り消し/やり直しの実体。既定は store の Undo（ADR-0020）。
 *   **画面ローカル下書きを持つ画面**（テンプレ作成＝`LooksEditScreen`）は、store ではなく自前の履歴
 *   （{@link ../hooks/useDraftHistory}）を渡す。キー入口の判定（修飾キー・入力欄では奪わない）を1か所で共有し、
 *   画面ごとに書き分けない（#547 P2-3）。App の全体登録は `UNDO_REDO_SCREENS` で looks-edit を除外済み＝二重登録しない。
 */
export function useUndoRedoShortcuts(enabled: boolean, handlers?: { undo: () => void; redo: () => void }): void {
  const storeUndo = useProjectStore((s) => s.undo);
  const storeRedo = useProjectStore((s) => s.redo);
  const undo = handlers?.undo ?? storeUndo;
  const redo = handlers?.redo ?? storeRedo;
  useEffect(() => {
    if (!enabled) return; // 対象外の画面では購読しない＝画面外の編集を無言で巻き戻さない（#547 P1-1）
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      if (shouldIgnoreShortcut(e)) return; // 入力中は標準の文字 Undo に任せる／変換中は奪わない
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, undo, redo]);
}
