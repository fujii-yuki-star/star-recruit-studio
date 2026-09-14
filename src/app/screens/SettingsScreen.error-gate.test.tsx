// @vitest-environment jsdom
// 設定の断りは**画面に出せる文だけ**を出す（#1123・PR #1130 レビュー由来 🟡）。
//
// ⚠️ **配線そのものを見る**＝走査（`src/test/rawErrorDisplayGuard.test.ts`）は「生の形が無い」ことしか
// 見られないので、**関門を通しておきながら結果を捨てる**ような配線の取り違えは拾えない。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  // ⚠️ **`vi.mock` の差し替えは `restoreAllMocks` で戻らない**（レビュー由来 ℹ️）＝
  // `vi.spyOn` のぶんしか戻らないので、`mockRejectedValue` が**次の検査の既定**として残り、
  // あとから足した人が**理由の分からない赤**を踏む。毎回そろえ直す。
  beforeEach(() => {
    vi.mocked(hasApiKey).mockReset().mockResolvedValue(false);
    vi.mocked(saveApiKey).mockReset().mockResolvedValue(undefined);
    vi.mocked(deleteApiKey).mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("保存できたなら、状態を確かめられなくても「保存できませんでした」と言わない", async () => {
    vi.mocked(saveApiKey).mockResolvedValue(undefined);
    vi.mocked(hasApiKey).mockResolvedValueOnce(false).mockRejectedValueOnce("os error 3");
    await typeKeyAndSave();
    await waitFor(() => expect(document.body.textContent).toMatch(/接続キーは保存できましたが/));
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
    // ⚠️ **空振りする形にしない**（レビュー由来 ℹ️）＝以前は `saveApiKey` が呼ばれたことだけを待ち
    // （クリックの時点で既に真）、`if (input)` で**欄が無ければ何も検査せずに緑**だった。
    // 欄が**在って空になる**ことを直接待つ。
    vi.mocked(saveApiKey).mockResolvedValue(undefined);
    vi.mocked(hasApiKey).mockResolvedValue(false); // 未接続のまま＝欄が出続ける
    await typeKeyAndSave();
    await waitFor(() =>
      expect((screen.getByPlaceholderText("接続キーを貼り付け") as HTMLInputElement).value).toBe(""),
    );
  });

  // ⚠️ **理由は記録へ流す**（レビュー由来 ℹ️）＝画面に出す文は「保存はできた」を守るために
  // こちらのものを使うが、**中身を捨てると調べる材料が減る**（`troubleLogBridge` が記録へ運ぶ）。
  it("状態を確かめられなかった理由は、記録へ流す（捨てない）", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(saveApiKey).mockResolvedValue(undefined);
    vi.mocked(hasApiKey).mockResolvedValueOnce(false).mockRejectedValueOnce("鍵の保管領域にアクセスできませんでした。");
    await typeKeyAndSave();
    await waitFor(() => expect(document.body.textContent).toMatch(/接続キーは保存できましたが/));
    expect(spy.mock.calls.some((c) => String(c[0]).includes("api-key-save")), "理由を記録へ流していない").toBe(true);
  });

  // ⚠️ **あとから来た起動時の読み取りで、操作の結果を上書きしない**（レビュー由来 ℹ️）＝
  // `projectStore` の「丸ごと set で並行編集を巻き戻す」と同型。
  // ⚠️ **外れたかどうかだけでは足りない**＝画面に居るまま遅れて解決する筋がある。
  it("遅れて解決した起動時の読み取りは、保存の結果を巻き戻さない", async () => {
    let settleMount!: (v: boolean) => void;
    vi.mocked(hasApiKey)
      .mockImplementationOnce(() => new Promise<boolean>((r) => { settleMount = r; }))
      .mockRejectedValueOnce("os error 3");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(saveApiKey).mockResolvedValue(undefined);
    await typeKeyAndSave();
    await waitFor(() => expect(document.body.textContent).toMatch(/接続キーは保存できましたが/));
    // ここで**起動時の読み取り**が「未登録」で遅れて解決する＝採ってはいけない。
    await act(async () => { settleMount(false); });
    expect(await screen.findByText("接続済み"), "遅れて来た起動時の結果で巻き戻っている").toBeTruthy();
  });

  // ⚠️ **案内の先で黙らない**（#1134 レビュー由来 🟡）＝上の断りは「設定を開き直してご確認ください」と
  // 言うので、**開き直した先**で確認がまた失敗したときに黙ると、案内が**空手形**になる
  //（直前の「保存できました」と食い違って、何も言わずに「未接続」へ変わる）。
  it("画面に入った時点で確かめられなければ、そう言う（黙って未接続にしない）", async () => {
    vi.mocked(hasApiKey).mockRejectedValue("os error 3");
    render(<SettingsScreen onNavigate={vi.fn()} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/接続の状態を確かめられませんでした/));
    // ⚠️ **「無い」側へ倒す**＝在ると偽って AI の機能を押させない。
    expect(screen.getByText("未接続")).toBeTruthy();
  });

  // ⚠️ **双子の片方だけ直さない**＝削除側も同じ形。
  it("削除できたなら、状態を確かめられなくても「削除できませんでした」と言わない", async () => {
    vi.mocked(hasApiKey).mockResolvedValueOnce(true).mockRejectedValueOnce("os error 3");
    vi.mocked(deleteApiKey).mockResolvedValue(undefined);
    render(<SettingsScreen onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByText("接続を削除する"));
    fireEvent.click(await screen.findByRole("button", { name: "削除する" }));
    await waitFor(() => expect(document.body.textContent).toMatch(/接続キーは削除できましたが/));
    expect(document.body.textContent).not.toMatch(/接続を削除できませんでした/);
  });
});
