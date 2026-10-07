// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { claimEscape } from "./escapeOwners";
import { usePointerDrag } from "./usePointerDrag";
import type { ReactElement } from "react";
import { useProjectStore } from "../store/projectStore";
import type { ExportPhase } from "../store/projectStore";
import { isUndoRedoEnabledFor, UNDO_REDO_SCREENS, useUndoRedoShortcuts } from "./useUndoRedoShortcuts";

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

  it("有効画面＝store 履歴をその画面で編集している画面だけ（テンプレ作成 looks-edit は対象外）", () => {
    // 判定基準は「取り消すUIの有無」ではなく **store 履歴（meta/parts/scenes）をその画面で編集しているか**。
    expect(UNDO_REDO_SCREENS.has("draft")).toBe(true); // #413：たたき台の削除/移動も Ctrl+Z で戻せる
    expect(UNDO_REDO_SCREENS.has("scene-edit")).toBe(true);
    // テンプレ作成は #547 P2-3 で取り消す/やり直すを持つが、戻す対象は**画面ローカル下書き**（useDraftHistory）。
    // store Undo を有効にすると画面外の編集を巻き戻すので、この集合には入れない（本 issue の本体・#547 P1-1）。
    expect(UNDO_REDO_SCREENS.has("looks-edit")).toBe(false);
    // store 履歴を画面で扱っていない画面も「見えていないものを Undo」になるため対象外。
    expect(UNDO_REDO_SCREENS.has("materials")).toBe(false); // 素材は履歴対象外（ADR-0020）
    expect(UNDO_REDO_SCREENS.has("settings")).toBe(false);
    expect(UNDO_REDO_SCREENS.has("home")).toBe(false);
    // 意図しない拡大/縮小の検知（store 履歴を編集する画面と一致し続けること）。増やすときは ADR-0020「入口」も更新する。
    expect(UNDO_REDO_SCREENS.size).toBe(2);
  });
});

// #570 P2 レビュー：App 結線 `useUndoRedoShortcuts(isUndoRedoEnabledFor(screen, exportPhase))` の挙動を固定。
// App も本テストも**同じ述語 isUndoRedoEnabledFor** を参照＝結線のドリフト（&& 欠落・画面/フェーズ取り違え）をここで捕捉する。
// ボタンは inert で操作不可なのに Ctrl+Z だけ効く不整合を防ぐ＝書き出し中はリスナーを登録しない。
describe("書き出し中は Undo/Redo を無効化（App 結線・#570 P2 レビュー）", () => {
  let undo: ReturnType<typeof vi.fn>;
  let origUndo: () => void;
  beforeEach(() => {
    origUndo = useProjectStore.getState().undo;
    undo = vi.fn();
    useProjectStore.setState({ undo: undo as unknown as () => void });
  });
  afterEach(() => { useProjectStore.setState({ undo: origUndo }); vi.restoreAllMocks(); });

  it("結線述語：取り消しUIのある画面かつ書き出し中でないときだけ有効（App.tsx と同じシンボル）", () => {
    expect(isUndoRedoEnabledFor("draft", "idle")).toBe(true);
    expect(isUndoRedoEnabledFor("draft", "rendering")).toBe(false); // 書き出し中は無効
    expect(isUndoRedoEnabledFor("draft", "encoding")).toBe(false); // encoding も busy
    expect(isUndoRedoEnabledFor("draft", "done")).toBe(true); // 完了後は再び有効
    expect(isUndoRedoEnabledFor("materials", "idle")).toBe(false); // 取り消しUIの無い画面は常に無効
  });

  it("idle→rendering→idle：書き出し中だけ Ctrl+Z が効かず、完了後に再び効く", () => {
    // App と同じ述語でフックを駆動＝phase 遷移で enabled が切り替わる（App は exportPhase を store から選んで渡す）。
    let phase: ExportPhase = "idle";
    const { rerender } = renderHook(() => useUndoRedoShortcuts(isUndoRedoEnabledFor("draft", phase)));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
    expect(undo).toHaveBeenCalledTimes(1); // 書き出しでない＝効く

    phase = "rendering"; rerender();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
    expect(undo).toHaveBeenCalledTimes(1); // 書き出し中＝リスナ未登録で効かない（増えない）

    phase = "idle"; rerender();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
    expect(undo).toHaveBeenCalledTimes(2); // 完了後＝再び効く
  });
});

// #547 P2-3：画面ローカル履歴を持つ画面（テンプレ作成）は実体だけを差し替える。
// フック単体で分岐を固定しておくと、壊れたときに「フックか画面配線か」の切り分けが早い。
describe("handlers で実体を差し替えられる（#547 P2-3）", () => {
  it("handlers を渡すと store ではなくそちらが呼ばれる", () => {
    const origUndo = useProjectStore.getState().undo;
    const origRedo = useProjectStore.getState().redo;
    const storeUndo = vi.fn();
    const storeRedo = vi.fn();
    const localUndo = vi.fn();
    const localRedo = vi.fn();
    useProjectStore.setState({ undo: storeUndo as unknown as () => void, redo: storeRedo as unknown as () => void });
    renderHook(() => useUndoRedoShortcuts(true, { undo: localUndo, redo: localRedo }));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true }));
    expect(localUndo).toHaveBeenCalledTimes(1);
    expect(localRedo).toHaveBeenCalledTimes(1);
    expect(storeUndo).not.toHaveBeenCalled(); // store 履歴（画面外の編集）には触れない
    expect(storeRedo).not.toHaveBeenCalled();

    useProjectStore.setState({ undo: origUndo, redo: origRedo });
  });
});

// 掴んでいる間は巻き戻さない（#686 レビュー）。
// ⚠️ 合図は **`usePointerDrag` が掴んだ最中だけ**立てる（`Escape` の名乗りで代用すると、右クリック
// メニューや色の選択欄を開いている間じゅう全画面で `Ctrl+Z` が無言で効かなくなる）。
describe("掴んでいる間の取り消し", () => {
  function Grabber(): ReactElement {
    const begin = usePointerDrag();
    return <div data-testid="grab" onPointerDown={(e) => begin(e, { onMove: () => {} })} />;
  }

  it("帯などを掴んでいる間は効かせない（足元で文書が動くと結果が変わる）", () => {
    const undo = vi.fn();
    render(<Grabber />);
    renderHook(() => useUndoRedoShortcuts(true, { undo, redo: vi.fn() }));
    const el = screen.getByTestId("grab");
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 50, clientY: 0 }); // 掴んだ
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(undo).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 50, clientY: 0 }); // 離した
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1); // 離せば効く（塞ぎっぱなしにしない）
  });

  it("メニューや選択欄が開いているだけでは塞がない（掴む話より広く効かせない）", () => {
    const undo = vi.fn();
    const release = claimEscape(); // `Escape` は受け持っているが掴んではいない
    renderHook(() => useUndoRedoShortcuts(true, { undo, redo: vi.fn() }));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    release();
  });
});
