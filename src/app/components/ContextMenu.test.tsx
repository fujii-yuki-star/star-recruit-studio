// @vitest-environment jsdom
// 右クリックの操作メニュー（ADR-0033）。**開いたまま戻れない**を作らないことを固定する。
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContextMenu } from "./ContextMenu";

const items = [
  { label: "手前へ", onSelect: vi.fn() },
  { label: "この列を消す", danger: true, onSelect: vi.fn() },
];

describe("ContextMenu", () => {
  it("項目を選ぶと、その操作を呼んで閉じる", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={[{ label: "手前へ", onSelect }]} onClose={onClose} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "手前へ" }));
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape で閉じる（キーボードでも抜けられる）", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={items} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("画面の外へ出さない（出ると押せない）", () => {
    render(<ContextMenu x={99999} y={99999} items={items} onClose={vi.fn()} />);
    const menu = screen.getByRole("menu") as HTMLElement;
    expect(Number.parseInt(menu.style.left, 10)).toBeLessThanOrEqual(window.innerWidth);
    expect(Number.parseInt(menu.style.top, 10)).toBeLessThanOrEqual(window.innerHeight);
  });

  it("項目が無いときは何も出さない（空のメニューを開かない）", () => {
    render(<ContextMenu x={10} y={10} items={[]} onClose={vi.fn()} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
