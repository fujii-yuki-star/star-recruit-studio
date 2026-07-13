// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { LooksScreen } from "./LooksScreen";

// #410 sub4 レビュー：画面が busy を配線し忘れても CI が通っていた回帰を防ぐ。
// 作成/複製/削除の各非同期操作が「実行中ラベル」になり、対象ボタンが disabled（連打不可）になることを押さえる。
const userTemplate = { ...sampleTemplates[0], templateId: "user_tmpl_001", name: "マイ見た目" };

function pendingPromise<T>(): [Promise<T>, (v: T) => void] {
  let resolve!: (v: T) => void;
  const p = new Promise<T>((r) => { resolve = r; });
  return [p, resolve];
}

describe("LooksScreen busy 表示（#410 sub4 レビュー）", () => {
  beforeEach(() => {
    useProjectStore.setState({ templates: [userTemplate, ...sampleTemplates], assets: [], scenes: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it("複製中は「複製中…」＋ボタン無効（連打不可）", () => {
    const [p] = pendingPromise<string>();
    useProjectStore.setState({ duplicateAsUserTemplate: vi.fn(() => p) });
    render(<LooksScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("この見た目を複製して編集する"));
    const btn = screen.getByText("複製中…").closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("作成中は「作成中…」＋ボタン無効", () => {
    const [p] = pendingPromise<string>();
    useProjectStore.setState({ createBlankUserTemplate: vi.fn(() => p) });
    render(<LooksScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("＋ ゼロから新しい見た目を作る"));
    fireEvent.click(screen.getByText("作成して編集する"));
    const btn = screen.getByText("作成中…").closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // 作成中は「やめる」も無効＝フォームを閉じて裏で作成完了→遷移する逃げ道を塞ぐ（#410 sub4 レビュー P2）。
    expect((screen.getByText("やめる").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("削除中は「削除中…」＋確認ボタン無効（DeleteConfirm に busy 配線）", () => {
    const [p] = pendingPromise<boolean>();
    useProjectStore.setState({ deleteUserTemplate: vi.fn(() => p) });
    render(<LooksScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("この見た目パターンを削除"));
    fireEvent.click(screen.getByText("削除する"));
    const btn = screen.getByText("削除中…").closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // 削除中はテンプレ選択カードも無効＝別テンプレを選んで確認UIを消し、削除だけ裏で進める逃げ道を塞ぐ（#410 sub4 レビュー P2）。
    expect((document.querySelector(".action-card") as HTMLButtonElement).disabled).toBe(true);
  });
});
