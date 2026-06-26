// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { FreeLayoutOverlay } from "./FreeLayoutOverlay";
import type { FreeElement } from "../../domain/project/types";
import { FREE_ELEMENT_KIND } from "../../domain/enums";

// FreeLayoutOverlay の「対話」をブラウザ非依存で自動検証するサンプル（ADR-0014）。
// 各要素ボックスの中身（テキスト等）は重ねる ScenePreview 側が描くため overlay のボックスは
// ロール/テキストで引けない。よってルート直下の子要素を構造で参照する（順序は freeLayout と一致）。
// 一方、右クリックメニュー（role="menu"/"menuitem"）とインライン編集の textarea はロールで引ける。

const CANVAS_W = 1920;
const CANVAS_H = 1080;

function makeLayout(): FreeElement[] {
  return [
    { id: "free_001", kind: FREE_ELEMENT_KIND.text, x: 100, y: 100, w: 400, h: 120, zIndex: 2, text: "見出し" },
    { id: "free_002", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 200, h: 200, zIndex: 1 },
  ];
}

function renderOverlay(overrides: Partial<ComponentProps<typeof FreeLayoutOverlay>> = {}) {
  const spies = {
    onSelect: vi.fn(),
    onChange: vi.fn(),
    onMoveMany: vi.fn(),
    onDuplicate: vi.fn(),
    onBringToFront: vi.fn(),
    onSendToBack: vi.fn(),
    onDelete: vi.fn(),
    onChangeText: vi.fn(),
    onRequestEdit: vi.fn(),
  };
  const result = render(
    <FreeLayoutOverlay
      freeLayout={makeLayout()}
      canvasW={CANVAS_W}
      canvasH={CANVAS_H}
      selectedIds={[]}
      {...spies}
      {...overrides}
    />,
  );
  const root = result.container.firstElementChild as HTMLElement;
  const boxes = Array.from(root.children) as HTMLElement[]; // [0]=free_001(text), [1]=free_002(shape)
  return { ...spies, root, boxes, ...result };
}

describe("FreeLayoutOverlay: 選択とリサイズハンドル", () => {
  it("各要素を 1 ボックスずつ描画し、選択中の要素にだけリサイズハンドル（4つ）が出る", () => {
    const { root, boxes } = renderOverlay({ selectedIds: ["free_001"] });
    expect(root).toBeInTheDocument();
    expect(boxes).toHaveLength(2);
    expect(boxes[0].children).toHaveLength(4); // free_001（選択中＝主）＝4 ハンドル
    expect(boxes[1].children).toHaveLength(0); // free_002（非選択）＝ハンドルなし
  });

  it("要素を押すと、その id で選択コールバックが呼ばれる", () => {
    const { boxes, onSelect } = renderOverlay();
    fireEvent.pointerDown(boxes[1], { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("free_002");
  });

  it("要素押下はルートまで伝播せず、選択が解除されない（stopPropagation）", () => {
    const { boxes, onSelect } = renderOverlay();
    fireEvent.pointerDown(boxes[0], { button: 0, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("free_001");
    expect(onSelect).not.toHaveBeenCalledWith(null);
  });

  it("何もない所（ルート）を押すと選択が解除される（null）", () => {
    const { root, onSelect } = renderOverlay({ selectedIds: ["free_001"] });
    fireEvent.pointerDown(root, { button: 0, clientX: 5, clientY: 5, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe("FreeLayoutOverlay: 複数選択・一括操作（#206）", () => {
  it("複数選択時、リサイズハンドルは主（selectedIds 末尾）にだけ出る", () => {
    const { boxes } = renderOverlay({ selectedIds: ["free_002", "free_001"] });
    expect(boxes[0].children).toHaveLength(4); // free_001＝末尾＝主＝ハンドルあり
    expect(boxes[1].children).toHaveLength(0); // free_002＝選択中だが主でない＝ハンドルなし
  });

  it("Shift＋クリックは選択トグル（additive=true）で呼ばれ、ドラッグ移動は始まらない", () => {
    const { boxes, onSelect, onMoveMany } = renderOverlay({ selectedIds: ["free_001"] });
    fireEvent.pointerDown(boxes[1], { button: 0, shiftKey: true, clientX: 50, clientY: 50, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("free_002", true);
    fireEvent.pointerMove(boxes[1], { clientX: 90, clientY: 90, pointerId: 1 });
    expect(onMoveMany).not.toHaveBeenCalled(); // Shift＋クリックは選択操作のみ
  });

  it("選択済みの要素をドラッグすると、選択中の全要素が同じ差分で一括移動する（onMoveMany）", () => {
    const { root, boxes, onMoveMany } = renderOverlay({ selectedIds: ["free_001", "free_002"] });
    // jsdom は実レイアウトを持たず clientWidth=0（→scale=0）になるため、canvas と等倍（scale=1）になるよう明示。
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    // 主（free_001・末尾）を掴んで動かす。free_001 start=(100,100), free_002 start=(0,0)、差分(+30,+40)。
    fireEvent.pointerDown(boxes[0], { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(boxes[0], { clientX: 30, clientY: 40, pointerId: 1 });
    expect(onMoveMany).toHaveBeenLastCalledWith([
      { id: "free_001", x: 130, y: 140 },
      { id: "free_002", x: 30, y: 40 },
    ]);
  });
});

describe("FreeLayoutOverlay: 吸着ガイド（#205 後半）", () => {
  it("他要素の左辺の近くへドラッグすると左辺に吸着し、縦ガイド線が現れる", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 400, w: 200, h: 100, zIndex: 1 },
      { id: "free_002", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 80, h: 40, zIndex: 2 },
    ];
    const { root, onMoveMany } = renderOverlay({ freeLayout: layout, selectedIds: ["free_002"] });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    const box002 = root.children[1] as HTMLElement;
    expect(screen.queryByTestId("snap-guide-x")).not.toBeInTheDocument(); // ドラッグ前はガイドなし
    // free_002(left=0) を +96 動かすと left=96。free_001.left=100 に距離4（threshold 6 以内）→ x=100 に吸着。
    fireEvent.pointerDown(box002, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(box002, { clientX: 96, clientY: 5, pointerId: 1 });
    expect(onMoveMany).toHaveBeenLastCalledWith([{ id: "free_002", x: 100, y: 5 }]); // 左辺に吸着
    expect(screen.getByTestId("snap-guide-x")).toBeInTheDocument(); // 縦ガイド線が現れる
    // ドラッグ終了でガイドは消える。
    fireEvent.pointerUp(box002, { pointerId: 1 });
    expect(screen.queryByTestId("snap-guide-x")).not.toBeInTheDocument();
  });

  it("どの辺も threshold 外なら吸着せずガイドも出ない", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 400, w: 200, h: 100, zIndex: 1 },
      { id: "free_002", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 80, h: 40, zIndex: 2 },
    ];
    const { root, onMoveMany } = renderOverlay({ freeLayout: layout, selectedIds: ["free_002"] });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    const box002 = root.children[1] as HTMLElement;
    fireEvent.pointerDown(box002, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    // x=40 → left=40/right=120/centerX=80。free_001 の left100/right300/centerX200 のどれにも 6px 以内で当たらない。
    fireEvent.pointerMove(box002, { clientX: 40, clientY: 40, pointerId: 1 });
    expect(onMoveMany).toHaveBeenLastCalledWith([{ id: "free_002", x: 40, y: 40 }]);
    expect(screen.queryByTestId("snap-guide-x")).not.toBeInTheDocument(); // ガイドなし
    expect(screen.queryByTestId("snap-guide-y")).not.toBeInTheDocument();
  });
});

describe("FreeLayoutOverlay: 右クリックの操作メニュー（#174）", () => {
  it("テキスト要素を右クリックすると「編集/複製/前面/背面/削除」が並ぶ", () => {
    const { boxes } = renderOverlay();
    fireEvent.contextMenu(boxes[0], { clientX: 100, clientY: 100 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    const labels = screen.getAllByRole("menuitem").map((b) => b.textContent);
    expect(labels).toEqual(["編集", "複製", "前面", "背面", "削除"]);
  });

  it("図形の右クリックにも「編集」が並ぶ（#185：全 kind で kind 別エディタを開く）", () => {
    const { boxes } = renderOverlay();
    fireEvent.contextMenu(boxes[1], { clientX: 100, clientY: 100 });
    const labels = screen.getAllByRole("menuitem").map((b) => b.textContent);
    expect(labels).toEqual(["編集", "複製", "前面", "背面", "削除"]);
  });

  it("「複製」を押すと対象 id で onDuplicate が呼ばれ、メニューが閉じる", () => {
    const { boxes, onDuplicate } = renderOverlay();
    fireEvent.contextMenu(boxes[1], { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByRole("menuitem", { name: "複製" }));
    expect(onDuplicate).toHaveBeenCalledWith("free_002");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("「削除」を押すと対象 id で onDelete が呼ばれる", () => {
    const { boxes, onDelete } = renderOverlay();
    fireEvent.contextMenu(boxes[1], { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "削除" }));
    expect(onDelete).toHaveBeenCalledWith("free_002");
  });

  it("Escape でメニューが閉じる", () => {
    const { boxes } = renderOverlay();
    fireEvent.contextMenu(boxes[0], { clientX: 100, clientY: 100 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("FreeLayoutOverlay: テキストのインライン編集（#174）", () => {
  // テキスト要素をダブルクリックして編集中の textarea を返す。
  function openTextEditor() {
    const ctx = renderOverlay();
    fireEvent.doubleClick(ctx.boxes[0]); // free_001（text）
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    return { ...ctx, textarea };
  }

  it("メニューの「編集」で onRequestEdit が対象 id と座標で呼ばれメニューが閉じる（#185：kind 別エディタを開く）", () => {
    const { boxes, onRequestEdit } = renderOverlay();
    fireEvent.contextMenu(boxes[0], { clientX: 120, clientY: 140 });
    fireEvent.click(screen.getByRole("menuitem", { name: "編集" }));
    expect(onRequestEdit).toHaveBeenCalledWith("free_001", expect.any(Number), expect.any(Number));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(); // 「編集」を押すとメニューは閉じる
    // textarea はダブルクリックで開く（編集メニューはポップオーバー＝親側を開くのみ）。
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("テキスト要素のダブルクリックで textarea が現れ、現在の文字が入る", () => {
    const { textarea } = openTextEditor();
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue("見出し");
  });

  it("textarea へ入力すると、対象 id と入力値で onChangeText が呼ばれる", () => {
    const { textarea, onChangeText } = openTextEditor();
    fireEvent.change(textarea, { target: { value: "新しい見出し" } });
    expect(onChangeText).toHaveBeenCalledWith("free_001", "新しい見出し");
  });

  it("Enter（Shift なし）で編集を抜ける（textarea が消える）", () => {
    const { textarea } = openTextEditor();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Esc で編集を抜ける", () => {
    const { textarea } = openTextEditor();
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("フォーカスを外す（blur）と編集を抜ける", () => {
    const { textarea } = openTextEditor();
    fireEvent.blur(textarea);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Shift+Enter は改行のため編集を抜けない（textarea が残る）", () => {
    const { textarea } = openTextEditor();
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("テキスト以外（図形）のダブルクリックでは textarea は出ない", () => {
    const { boxes } = renderOverlay();
    fireEvent.doubleClick(boxes[1]); // free_002（shape）
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("FreeLayoutOverlay: 回転（#208）", () => {
  it("回転している主要素は CSS rotate を当て、リサイズハンドルは出さない（大きさは数値入力で）", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 100, w: 200, h: 100, zIndex: 1, rotation: 30 },
    ];
    const { root } = renderOverlay({ freeLayout: layout, selectedIds: ["free_001"] });
    const box = root.children[0] as HTMLElement;
    expect(box.style.transform).toContain("rotate(30deg)");
    expect(box.children).toHaveLength(0); // 回転中＝ハンドルなし
  });

  it("回転 0（未指定）の主要素はハンドル4つを出し、transform を付けない", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 100, w: 200, h: 100, zIndex: 1 },
    ];
    const { root } = renderOverlay({ freeLayout: layout, selectedIds: ["free_001"] });
    const box = root.children[0] as HTMLElement;
    expect(box.style.transform).toBe("");
    expect(box.children).toHaveLength(4); // 回転なし＝リサイズハンドル
  });
});

describe("FreeLayoutOverlay: 非表示/ロック（#210）", () => {
  it("hidden の要素は箱を描かない（レイヤー一覧から再表示）", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 100, h: 100, zIndex: 1, hidden: true },
      { id: "free_002", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 100, h: 100, zIndex: 2 },
    ];
    const { root } = renderOverlay({ freeLayout: layout });
    expect(root.children).toHaveLength(1); // free_001 は描かれず free_002 の1箱のみ
  });

  it("ロック中の要素はクリックで選択されるが、ドラッグしても移動しない", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 100, w: 200, h: 100, zIndex: 1, locked: true },
    ];
    const { root, onSelect, onMoveMany } = renderOverlay({ freeLayout: layout, selectedIds: ["free_001"] });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    const box = root.children[0] as HTMLElement;
    fireEvent.pointerDown(box, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("free_001"); // 選択はされる
    fireEvent.pointerMove(box, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(onMoveMany).not.toHaveBeenCalled(); // ロック中は移動しない
    expect(box.children).toHaveLength(0); // リサイズハンドルも出さない
  });
});
