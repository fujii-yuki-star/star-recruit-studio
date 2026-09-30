// @vitest-environment jsdom
// 設定の「動画案を作るAI」＝既定はこのパソコンの中・Gemini は選んだときだけ（ADR-0051 決定15）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsScreen } from "./SettingsScreen";

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* 保存できない環境 */ }
});

describe("設定：動画案を作るAI の選び方（ADR-0051）", () => {
  it("既定は「このパソコンの中で作る」＝接続キーの欄は出さない", () => {
    render(<SettingsScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "このパソコンの中で作る", pressed: true })).toBeTruthy();
    expect(screen.queryByPlaceholderText("接続キーを貼り付け")).toBeNull();
    expect(screen.getByText(/入力した内容は外へ送りません/)).toBeTruthy();
  });

  it("Gemini を選ぶと接続キーの欄が出て、選んだことを覚える", () => {
    const { unmount } = render(<SettingsScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Gemini を使う" }));
    expect(screen.getByPlaceholderText("接続キーを貼り付け")).toBeTruthy();
    expect(window.localStorage.getItem("app.aiEngine")).toBe("gemini");
    unmount();
    render(<SettingsScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Gemini を使う", pressed: true })).toBeTruthy();
  });

  it("このパソコンの中に戻すと、接続キーの欄を閉じる", () => {
    window.localStorage.setItem("app.aiEngine", "gemini");
    render(<SettingsScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "このパソコンの中で作る" }));
    expect(screen.queryByPlaceholderText("接続キーを貼り付け")).toBeNull();
    expect(window.localStorage.getItem("app.aiEngine")).toBe("local");
  });
});
