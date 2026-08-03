// @vitest-environment jsdom
// 見た目パターン編集の欄の配置（ADR-0033 段階4 後半）。**いままでの見え方を保ったまま**組み替えられること。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { LooksEditScreen } from "./LooksEditScreen";
import type { Template } from "../../domain/template/types";

const template = {
  schemaVersion: "1.0", templateId: "user_tmpl_001", name: "わたしの見た目", category: "photo_intro",
  aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

beforeEach(() => {
  useProjectStore.setState({
    templates: [template], scenes: [], parts: [], assets: [],
    editingTemplateId: template.templateId, saveStatus: "saved",
  } as never);
  // 配置はアプリの設定に残る＝テスト間で持ち越さない。
  localStorage.clear();
});

describe("LooksEditScreen: 欄の配置（ADR-0033 段階4 後半）", () => {
  it("既定はいままでと同じ顔ぶれ（プレビューと編集が同時に見える）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "プレビュー" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "見た目パターンの編集" })).toBeInTheDocument();
  });

  it("欄を閉じられて、戻す導線が出る", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("プレビューの欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    expect(screen.queryByRole("heading", { name: "プレビュー" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "「プレビュー」を表示する" }));
    expect(screen.getByRole("heading", { name: "プレビュー" })).toBeInTheDocument();
  });

  it("配置は覚えていて、ほかの画面とは別に持つ", () => {
    const first = render(<LooksEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("プレビューの欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    first.unmount();
    expect(localStorage.getItem("app.panelLayout.looks")).not.toBeNull();
    expect(localStorage.getItem("app.panelLayout.scene")).toBeNull();
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "プレビュー" })).not.toBeInTheDocument();
  });

  it("「配置を既定に戻す」で戻る", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("プレビューの欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    fireEvent.click(screen.getByRole("button", { name: "配置を既定に戻す" }));
    expect(screen.getByRole("heading", { name: "プレビュー" })).toBeInTheDocument();
  });

  it("配置を触らずに開いているだけでは、既定を焼き付けない（あとで既定を良くしたときに届く）", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<LooksEditScreen onNavigate={vi.fn()} />);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      unmount();
      expect(localStorage.getItem("app.panelLayout.looks")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
