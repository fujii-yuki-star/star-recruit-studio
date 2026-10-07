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

// 消えないものにはゴミ箱を出さない／行の中にも置ける（#990）。
describe("DeleteConfirm：ゴミ箱と行の中の形（#990）", () => {
  const svgIn = (el: HTMLElement): SVGElement | null => el.querySelector("svg");

  it("既定ではゴミ箱を出す（削除の固定形）", () => {
    render(<DeleteConfirm message="消しますか？" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(svgIn(screen.getByRole("button", { name: /削除する/ })), "削除なのにゴミ箱が無い").not.toBeNull();
  });

  // ⚠️ **何も消えない操作に同じ見た目を当てると、「やめるのつもりが削除」を防ぐ合図が薄まる**。
  it("`showIcon={false}` ならゴミ箱を出さない（消えるものが無い操作）", () => {
    render(<DeleteConfirm message="バラしますか？" confirmLabel="バラす" showIcon={false} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /バラす/ });
    expect(svgIn(btn), "消えないのにゴミ箱が出ている").toBeNull();
    expect(btn.className, "取り消しでしか戻らないので危険色は残す").toContain("btn-danger");
  });

  // ⚠️ **行の中でも、並び・色・焦点・`Escape` は同じ**＝手書きに逃がすと、そこだけ全部無くなる。
  it("行の中の形でも「やめる」が左・危険色が右", () => {
    render(<DeleteConfirm inline message="消しますか？" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].textContent).toContain("やめる");
    expect(buttons[1].className).toContain("btn-danger");
  });

  it("行の中の形でも、出た瞬間に「やめる」へ手が移る", () => {
    render(<DeleteConfirm inline message="消しますか？" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(document.activeElement?.textContent, "安全な側へ手が移っていない").toContain("やめる");
  });

  it("行の中の形でも、`Escape` でやめられる", () => {
    const onCancel = vi.fn();
    render(<DeleteConfirm inline message="消しますか？" onCancel={onCancel} onConfirm={vi.fn()} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("行の中の形では知らせの箱にしない（行に収まる）", () => {
    const { container } = render(<DeleteConfirm inline message="消しますか？" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(container.querySelector(".notice"), "行の中なのに箱で出ている").toBeNull();
  });
});
