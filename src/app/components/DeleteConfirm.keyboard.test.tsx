// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { hasEscapeOwner } from "../hooks/escapeOwners";
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
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // #963 レビュー 🟡1：横取りせず、**名簿**（`escapeOwners`）で外側と調停する。
  it("受け持っている間は名簿に名乗る（外側の後始末を同時に走らせない）", () => {
    expect(hasEscapeOwner()).toBe(false);
    const { unmount } = render(<DeleteConfirm message="消しますか？" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(hasEscapeOwner()).toBe(true);
    unmount();
    expect(hasEscapeOwner()).toBe(false);
  });

  it("実行中は名乗らない（止められないものを受け持たない）", () => {
    const { unmount } = render(<DeleteConfirm message="消しますか？" busy onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(hasEscapeOwner()).toBe(false);
    unmount();
  });

  it("入力中の Escape は横取りしない（打っている欄のもの）", () => {
    const onCancel = vi.fn();
    const area = document.createElement("textarea");
    document.body.appendChild(area);
    render(<DeleteConfirm message="消しますか？" onCancel={onCancel} onConfirm={vi.fn()} />);
    area.focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    area.remove();
  });

  it("Escape 以外は何もしない", () => {
    const onCancel = vi.fn();
    render(<DeleteConfirm message="消しますか？" onCancel={onCancel} onConfirm={vi.fn()} />);
    fireEvent.keyDown(window, { key: "a" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("実行中は Escape で止めない／押せないボタンへ焦点を移さない", () => {
    const onCancel = vi.fn();
    render(<DeleteConfirm message="消しますか？" busy onCancel={onCancel} onConfirm={vi.fn()} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(screen.getByText("やめる").closest("button"));
  });

  it("消えたあとは Escape を拾わない（後始末）", () => {
    const onCancel = vi.fn();
    const { unmount } = render(<DeleteConfirm message="消しますか？" onCancel={onCancel} onConfirm={vi.fn()} />);
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
