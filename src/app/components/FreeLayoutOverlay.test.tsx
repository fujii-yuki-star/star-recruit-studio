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
    onDuplicate: vi.fn(),
    onBringToFront: vi.fn(),
    onSendToBack: vi.fn(),
    onDelete: vi.fn(),
    onChangeText: vi.fn(),
  };
  const result = render(
    <FreeLayoutOverlay
      freeLayout={makeLayout()}
      canvasW={CANVAS_W}
      canvasH={CANVAS_H}
      selectedId={null}
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
    const { root, boxes } = renderOverlay({ selectedId: "free_001" });
    expect(root).toBeInTheDocument();
    expect(boxes).toHaveLength(2);
    expect(boxes[0].children).toHaveLength(4); // free_001（選択中）＝4 ハンドル
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
    const { root, onSelect } = renderOverlay({ selectedId: "free_001" });
    fireEvent.pointerDown(root, { button: 0, clientX: 5, clientY: 5, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith(null);
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

  it("テキスト以外（図形）の右クリックには「編集」が出ない", () => {
    const { boxes } = renderOverlay();
    fireEvent.contextMenu(boxes[1], { clientX: 100, clientY: 100 });
    const labels = screen.getAllByRole("menuitem").map((b) => b.textContent);
    expect(labels).toEqual(["複製", "前面", "背面", "削除"]);
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

  it("メニューの「編集」（テキスト）でインライン編集の textarea が現れる", () => {
    const { boxes } = renderOverlay();
    fireEvent.contextMenu(boxes[0], { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByRole("menuitem", { name: "編集" }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(); // 編集に入るとメニューは閉じる
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
