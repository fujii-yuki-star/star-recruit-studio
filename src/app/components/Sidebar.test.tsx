// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import type { ScreenId } from "../data/mockData";

const setup = (over: { current?: ScreenId; hasProjectContent?: boolean; projectName?: string } = {}) => {
  const onNavigate = vi.fn();
  render(
    <Sidebar
      current={over.current ?? "home"}
      onNavigate={onNavigate}
      projectName={over.projectName ?? "無題のプロジェクト"}
      hasProjectContent={over.hasProjectContent ?? false}
    />,
  );
  return { onNavigate };
};

// 「今の動画」ボタン（2行構成）を取得。ラベル「今の動画」の最寄り button。
const currentVideoButton = (): HTMLElement | null => screen.queryByText("今の動画")?.closest("button") ?? null;

describe("Sidebar（IA再構成・#399 B案）", () => {
  it("先頭は「プロジェクト」＝一覧。押すと一覧（home）へ", () => {
    const { onNavigate } = setup();
    fireEvent.click(screen.getByText("プロジェクト").closest("button")!);
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("動画未オープン（idle・非工程画面）では「今の動画」を出さない＝一覧へ誘導", () => {
    setup({ current: "home", hasProjectContent: false });
    expect(currentVideoButton()).toBeNull();
  });

  it("動画を開いている間は「今の動画（名前）」を出し、押すとたたき台（draft）へ", () => {
    const { onNavigate } = setup({ current: "home", hasProjectContent: true, projectName: "採用2026" });
    expect(currentVideoButton()).not.toBeNull();
    expect(screen.getByText("採用2026")).toBeTruthy(); // 名前を表示（#252 合流）
    fireEvent.click(currentVideoButton()!);
    expect(onNavigate).toHaveBeenCalledWith("draft");
  });

  it("工程画面にいる間は content 無しでも「今の動画」を出す（active）", () => {
    setup({ current: "wizard", hasProjectContent: false });
    const btn = currentVideoButton();
    expect(btn).not.toBeNull();
    expect(btn!.className).toContain("active"); // 工程画面では「今の動画」が active
  });

  it("一覧画面では「プロジェクト」が active・「今の動画」は非active", () => {
    setup({ current: "home", hasProjectContent: true });
    expect(screen.getByText("プロジェクト").closest("button")!.className).toContain("active");
    expect(currentVideoButton()!.className).not.toContain("active");
  });

  it("見た目パターン編集中（looks-edit）でも「見た目パターン」が active＝現在地が消えない", () => {
    setup({ current: "looks-edit" });
    expect(screen.getByText("見た目パターン").closest("button")!.className).toContain("active");
  });
});
