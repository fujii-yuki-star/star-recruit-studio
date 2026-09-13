// @vitest-environment jsdom
// 設定の断りは**画面に出せる文だけ**を出す（#1123・PR #1130 レビュー由来 🟡）。
//
// ⚠️ **配線そのものを見る**＝走査（`src/test/rawErrorDisplayGuard.test.ts`）は「生の形が無い」ことしか
// 見られないので、**関門を通しておきながら結果を捨てる**ような配線の取り違えは拾えない。
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../infrastructure/aiClient", async (importActual) => ({
  ...(await importActual<typeof import("../../infrastructure/aiClient")>()),
  hasApiKey: vi.fn(() => Promise.resolve(false)),
  saveApiKey: vi.fn(() => Promise.resolve()),
}));

import { SettingsScreen } from "./SettingsScreen";
import { saveApiKey } from "../../infrastructure/aiClient";

async function typeKeyAndSave(): Promise<void> {
  render(<SettingsScreen onNavigate={vi.fn()} />);
  const input = await screen.findByPlaceholderText("接続キーを貼り付け");
  fireEvent.change(input, { target: { value: "test-key" } });
  fireEvent.click(screen.getByText("保存する"));
}

describe("接続キーの断りは、画面に出せる文だけ出す（#1123）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("整えた理由が返れば、その文を出す（丸めない）", async () => {
    vi.mocked(saveApiKey).mockRejectedValue(
      "このパソコンの鍵の保管庫を開けませんでした。パソコンを再起動してから、もう一度お試しください。",
    );
    await typeKeyAndSave();
    await waitFor(() => expect(document.body.textContent).toMatch(/鍵の保管庫を開けませんでした/));
  });

  it("生の OS エラーは出さず、定型文へ倒す（§2-3）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(saveApiKey).mockRejectedValue("os error 3");
    await typeKeyAndSave();
    await waitFor(() => expect(document.body.textContent).toMatch(/キーを保存できませんでした/));
    expect(document.body.textContent).not.toMatch(/os error/);
  });
});
