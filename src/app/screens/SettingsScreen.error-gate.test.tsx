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
  deleteApiKey: vi.fn(() => Promise.resolve()),
}));

import { SettingsScreen } from "./SettingsScreen";
import { deleteApiKey, hasApiKey, saveApiKey } from "../../infrastructure/aiClient";

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

// ⚠️ **「できなかった」と「確かめられなかった」を分ける**（#1131）＝以前は保存と状態の確認が
// 1つの `try` にあったので、**保存は成功したのに**「キーを保存できませんでした」と出た。
// しかも入力欄を先に消していたため、利用者は**実際には保存済みの鍵を打ち直す**ことになった。
describe("接続キーは、起きたことを言い分ける（#1131）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("保存できたなら、状態を確かめられなくても「保存できませんでした」と言わない", async () => {
    vi.mocked(saveApiKey).mockResolvedValue(undefined);
    vi.mocked(hasApiKey).mockResolvedValueOnce(false).mockRejectedValueOnce("os error 3");
    await typeKeyAndSave();
    await waitFor(() => expect(document.body.textContent).toMatch(/キーは保存できましたが/));
    expect(document.body.textContent, "保存できたのに「できませんでした」と出ている").not.toMatch(
      /キーを保存できませんでした/,
    );
    // ⚠️ **「在る」側へ倒す**＝保存できたのだから在る。確かめられなかっただけで
    // **未接続に見せる**と、利用者は使えると分からない（お試し用の動画案へ落ちる）。
    expect(await screen.findByText("接続済み"), "保存できたのに未接続に見せている").toBeTruthy();
  });

  it("保存できなかったら、入力は消さない（打ち直させる以上、消してはいけない）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(saveApiKey).mockRejectedValue("os error 3");
    await typeKeyAndSave();
    await waitFor(() => expect(document.body.textContent).toMatch(/キーを保存できませんでした/));
    const input = screen.getByPlaceholderText("接続キーを貼り付け") as HTMLInputElement;
    expect(input.value, "打ち直させるのに、入力を消している").toBe("test-key");
  });

  it("保存できたら、入力は消す（残すと「保存できていない」ように見える）", async () => {
    vi.mocked(saveApiKey).mockResolvedValue(undefined);
    await typeKeyAndSave();
    await waitFor(() => expect(vi.mocked(saveApiKey)).toHaveBeenCalled());
    const input = screen.queryByPlaceholderText("接続キーを貼り付け") as HTMLInputElement | null;
    // 接続済みになると欄ごと消える画面なので、**残っていたら空**であることを見る。
    if (input) expect(input.value).toBe("");
  });

  // ⚠️ **双子の片方だけ直さない**＝削除側も同じ形。
  it("削除できたなら、状態を確かめられなくても「削除できませんでした」と言わない", async () => {
    vi.mocked(hasApiKey).mockResolvedValueOnce(true).mockRejectedValueOnce("os error 3");
    vi.mocked(deleteApiKey).mockResolvedValue(undefined);
    render(<SettingsScreen onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByText("接続を削除する"));
    fireEvent.click(await screen.findByRole("button", { name: "削除する" }));
    await waitFor(() => expect(document.body.textContent).toMatch(/接続は削除できましたが/));
    expect(document.body.textContent).not.toMatch(/接続を削除できませんでした/);
  });
});
