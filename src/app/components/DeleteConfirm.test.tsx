// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeleteConfirm } from "./DeleteConfirm";

describe("DeleteConfirm（削除確認の統一・#410）", () => {
  it("「やめる」が左・「削除する」(danger)が右の順で固定される", () => {
    render(<DeleteConfirm message="消しますか？" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].textContent).toContain("やめる"); // 左＝やめる（デフォルト）
    expect(buttons[1].textContent).toContain("削除する"); // 右＝削除
    expect(buttons[1].className).toContain("btn-danger"); // 削除は危険色
  });

  it("やめる/削除する で各ハンドラを呼ぶ", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<DeleteConfirm message="X" onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("やめる"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("削除する"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("busy 中は両ボタン無効＋ラベル変化（連打/多重削除を防ぐ）", () => {
    render(<DeleteConfirm message="X" busy busyLabel="削除中…" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const buttons = screen.getAllByRole("button") as HTMLButtonElement[];
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(screen.getByText("削除中…")).toBeTruthy();
  });
});
