// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// 接続キー保存（ネットワーク）中は「保存中…」＋ボタン無効になること（#410 sub4）。
// saveApiKey を永久 pending にして「実行中」を観測する。hasApiKey=false で未接続＝キー入力欄を出す。
vi.mock("../../infrastructure/aiClient", async (importActual) => ({
  ...(await importActual<typeof import("../../infrastructure/aiClient")>()),
  hasApiKey: vi.fn(() => Promise.resolve(false)),
  saveApiKey: vi.fn(() => new Promise<void>(() => {})),
}));

import { SettingsScreen } from "./SettingsScreen";

describe("SettingsScreen 接続キー保存の busy 表示（#410 sub4）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("保存中は「保存中…」＋ボタン無効", async () => {
    render(<SettingsScreen onNavigate={vi.fn()} />);
    const input = await screen.findByPlaceholderText("接続キーを貼り付け");
    fireEvent.change(input, { target: { value: "test-key" } });
    fireEvent.click(screen.getByText("保存する"));
    const btn = (await screen.findByText("保存中…")).closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
