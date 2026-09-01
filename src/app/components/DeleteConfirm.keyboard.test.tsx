// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DeleteConfirm } from "./DeleteConfirm";

// #354：確認はキーボードだけでも「やめる」に戻れること。
// ⚠️ 実機で確かめて見つけた＝押した「◯◯を削除」がこの確認に置き換わるので、**焦点が本文の先頭へ落ちていた**。
describe("削除の確認のキーボード操作（#354）", () => {
  it("出た瞬間に「やめる」へ焦点が移る（安全な側・Enter で消えない）", () => {
    render(<DeleteConfirm message="消しますか？" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByText("やめる").closest("button"));
  });

  it("Escape でやめる", () => {
    const onCancel = vi.fn();
    render(<DeleteConfirm message="消しますか？" onCancel={onCancel} onConfirm={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape は奥へ通さない（やめると同時に選択まで解除しない）", () => {
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    render(<DeleteConfirm message="消しますか？" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    document.removeEventListener("keydown", outer);
    expect(outer).not.toHaveBeenCalled();
  });

  it("Escape 以外は通す（ほかの操作を奪わない）", () => {
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    render(<DeleteConfirm message="消しますか？" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    fireEvent.keyDown(document, { key: "a" });
    document.removeEventListener("keydown", outer);
    expect(outer).toHaveBeenCalled();
  });

  it("実行中は Escape で止めない／押せないボタンへ焦点を移さない", () => {
    const onCancel = vi.fn();
    render(<DeleteConfirm message="消しますか？" busy onCancel={onCancel} onConfirm={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(screen.getByText("やめる").closest("button"));
  });

  it("消えたあとは Escape を拾わない（後始末）", () => {
    const onCancel = vi.fn();
    const { unmount } = render(<DeleteConfirm message="消しますか？" onCancel={onCancel} onConfirm={vi.fn()} />);
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
