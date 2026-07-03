// Undo/Redo のキーボード入口（ADR-0020・#211/#255）。編集画面で共有し、場面編集とタイムライン編集で挙動を揃える。
// Ctrl/⌘+Z＝取り消し・Ctrl/⌘+Shift+Z／Ctrl+Y＝やり直し。テキスト入力中（input/textarea/contentEditable）は
// 標準の文字 Undo に任せ、ここでは奪わない。undo/redo は store から取得（呼び出し側は import して1回呼ぶだけ）。
import { useEffect } from "react";
import { useProjectStore } from "../store/projectStore";

export function useUndoRedoShortcuts(): void {
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  useEffect(() => {
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
  }, [undo, redo]);
}
