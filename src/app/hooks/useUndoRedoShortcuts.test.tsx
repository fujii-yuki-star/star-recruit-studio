// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { UNDO_REDO_SCREENS, useUndoRedoShortcuts } from "./useUndoRedoShortcuts";

// #211/#413：Undo/Redo のキーボード入口。App 一箇所で登録＝ここが唯一の入口なので挙動を固定する。
// テキスト入力中（input/textarea/contentEditable）は標準の文字 Undo に任せて奪わないことも含めて検証。
// #547 P1-1：有効画面を絞る（enabled=false では購読しない＝画面外の編集を巻き戻さない）。
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
    renderHook(() => useUndoRedoShortcuts(true)); // 有効画面として window に keydown リスナを張る
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

// #547 P1-1：store 履歴を画面で編集していない画面（テンプレ作成＝編集は画面ローカル draft）では購読しない。
// 有効なら画面外の場面/メタ編集を無言で巻き戻し、自動保存がそれを永続化してしまう（データ喪失・ADR-0026④）。
describe("useUndoRedoShortcuts 有効画面の限定（#547 P1-1）", () => {
  it("enabled=false では Ctrl+Z/Ctrl+Y を購読しない（画面外の編集を巻き戻さない）", () => {
    const origUndo = useProjectStore.getState().undo;
    const origRedo = useProjectStore.getState().redo;
    const undo = vi.fn();
    const redo = vi.fn();
    useProjectStore.setState({ undo: undo as unknown as () => void, redo: redo as unknown as () => void });
    renderHook(() => useUndoRedoShortcuts(false));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true }));
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
    useProjectStore.setState({ undo: origUndo, redo: origRedo });
  });

  // 実運用は「フックは常時マウントのまま screen 変化で enabled が true⇄false に遷移」＝#547 P1-1 の実バグ経路。
  // 依存配列 [enabled,...] の cleanup→再購読が効き、無効画面へ移った後は購読が残らないことを rerender で直接踏む。
  it("有効画面から対象外画面へ移ると購読が外れる（enabled true→false の遷移）", () => {
    const origUndo = useProjectStore.getState().undo;
    const undo = vi.fn();
    useProjectStore.setState({ undo: undo as unknown as () => void });
    const { rerender } = renderHook(({ enabled }) => useUndoRedoShortcuts(enabled), { initialProps: { enabled: true } });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
    expect(undo).toHaveBeenCalledTimes(1); // 有効画面では効く
    rerender({ enabled: false }); // 例：場面編集 → テンプレ作成へ移動
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
    expect(undo).toHaveBeenCalledTimes(1); // 増えない＝リスナが外れている（画面外の編集を巻き戻さない）
    useProjectStore.setState({ undo: origUndo });
  });

  it("有効画面＝取り消す/やり直すUIがある画面だけ（テンプレ作成 looks-edit は対象外）", () => {
    // 取り消す/やり直すUI を持ち、store 履歴（meta/parts/scenes）をその画面で編集している画面。
    expect(UNDO_REDO_SCREENS.has("draft")).toBe(true); // #413：たたき台の削除/移動も Ctrl+Z で戻せる
    expect(UNDO_REDO_SCREENS.has("scene-edit")).toBe(true);
    expect(UNDO_REDO_SCREENS.has("timeline-edit")).toBe(true);
    // 編集が画面ローカル（draft state）＝store Undo は画面外を巻き戻すので対象外（本 issue の本体）。
    expect(UNDO_REDO_SCREENS.has("looks-edit")).toBe(false);
    // store 履歴を画面で扱っていない画面も「見えていないものを Undo」になるため対象外。
    expect(UNDO_REDO_SCREENS.has("materials")).toBe(false); // 素材は履歴対象外（ADR-0020）
    expect(UNDO_REDO_SCREENS.has("settings")).toBe(false);
    expect(UNDO_REDO_SCREENS.has("home")).toBe(false);
    // 意図しない拡大/縮小の検知（Undo UI を持つ画面と一致し続けること）。増やすときは ADR-0020「入口」も更新する。
    expect(UNDO_REDO_SCREENS.size).toBe(3);
  });
});
