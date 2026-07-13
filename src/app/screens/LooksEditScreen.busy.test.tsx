// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { LooksEditScreen } from "./LooksEditScreen";

// #410 sub4 レビュー：見た目パターン編集の削除も、実行中は「削除中…」＋確認ボタン無効になること。
const userTemplate = { ...sampleTemplates[0], templateId: "user_tmpl_001", name: "マイ見た目" };

describe("LooksEditScreen 削除の busy 表示（#410 sub4 レビュー）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: [userTemplate, ...sampleTemplates],
      assets: [],
      editingTemplateId: "user_tmpl_001",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("削除中は「削除中…」＋確認ボタン無効（DeleteConfirm に busy 配線）", () => {
    useProjectStore.setState({ deleteUserTemplate: vi.fn(() => new Promise<boolean>(() => {})) });
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("この見た目パターンを削除"));
    fireEvent.click(screen.getByText("削除する"));
    const btn = screen.getByText("削除中…").closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // 削除中は「一覧へ戻る」も無効＝戻って裏で削除だけ進める逃げ道を塞ぐ（#410 sub4 レビュー P2）。
    expect((screen.getByText("一覧へ戻る").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
