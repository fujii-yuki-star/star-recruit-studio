// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { useUndoRedoShortcuts } from "./useUndoRedoShortcuts";

// #211/#413：Undo/Redo のキーボード入口。App で全画面登録するようにしたため、ここが唯一の入口＝挙動を固定する。
// テキスト入力中（input/textarea/contentEditable）は標準の文字 Undo に任せて奪わないことも含めて検証。
describe("useUndoRedoShortcuts（キーボード Undo/Redo・#211/#413）", () => {
  let undo: ReturnType<typeof vi.fn>;
  let redo: ReturnType<typeof vi.fn>;
  let origUndo: () => void;
  let origRedo: () => void;

  beforeEach(() => {
    origUndo = useProjectStore.getState().undo;
    origRedo = useProjectStore.getState().redo;
    undo = vi.fn();
    redo = vi.fn();
    useProjectStore.setState({ undo: undo as unknown as () => void, redo: redo as unknown as () => void });
    renderHook(() => useUndoRedoShortcuts()); // window に keydown リスナを張る
  });
  afterEach(() => {
    useProjectStore.setState({ undo: origUndo, redo: origRedo });
    vi.restoreAllMocks();
  });

  const press = (opts: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent("keydown", opts));

  it("Ctrl+Z で取り消し", () => {
    press({ key: "z", ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).not.toHaveBeenCalled();
  });

  it("Ctrl+Y でやり直し", () => {
    press({ key: "y", ctrlKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Shift+Z でやり直し（取り消しではない）", () => {
    press({ key: "z", ctrlKey: true, shiftKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  it("⌘+Z（Mac）でも取り消し", () => {
    press({ key: "z", metaKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("修飾キーなしの Z は無視（通常入力を奪わない）", () => {
    press({ key: "z" });
    expect(undo).not.toHaveBeenCalled();
  });

  it("テキスト入力中（input へフォーカス）は奪わず標準の文字 Undo に任せる", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(undo).not.toHaveBeenCalled();
    input.remove();
  });
});
