// @vitest-environment jsdom
// 時刻を見せて打ち込める欄（UI/UX 監査 2026-10-02）。
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ClockField } from "./ClockField";

describe("ClockField", () => {
  it("範囲の外は端へ寄せる（数値欄と同じ作法）", () => {
    const onCommit = vi.fn();
    render(<ClockField value={1} fps={30} max={5} onCommit={onCommit} ariaLabel="時刻" />);
    const f = screen.getByLabelText("時刻");
    fireEvent.change(f, { target: { value: "99" } });
    fireEvent.keyDown(f, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith(5);
  });

  it("焦点が入ったら表示を止める（再生中に値が変わっても打てる）", () => {
    const { rerender } = render(<ClockField value={1} fps={30} max={10} onCommit={vi.fn()} ariaLabel="時刻" />);
    const f = screen.getByLabelText("時刻") as HTMLInputElement;
    fireEvent.focus(f);
    rerender(<ClockField value={2} fps={30} max={10} onCommit={vi.fn()} ariaLabel="時刻" />);
    expect(f.value, "焦点がある間に表示が動いた").toBe("0:01.00");
  });

  it("書き方どおりに見せる（分:秒.コマ）", () => {
    render(<ClockField value={65.5} fps={30} max={100} onCommit={vi.fn()} ariaLabel="時刻" />);
    expect((screen.getByLabelText("時刻") as HTMLInputElement).value).toBe("1:05.15");
  });
});
