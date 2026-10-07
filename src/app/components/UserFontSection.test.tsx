// @vitest-environment jsdom
// 文字の形（持ち込みフォント・ADR-0038・#261）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("../../infrastructure/userFontFs", () => ({
  listUserFonts: vi.fn(),
  userFontCssFamily: vi.fn(),
}));
vi.mock("../../infrastructure/dialog", () => ({ showOpenFontDialog: vi.fn(async () => null) }));

import { UserFontSection } from "./UserFontSection";
import { useProjectStore } from "../store/projectStore";
import { listUserFonts } from "../../infrastructure/userFontFs";

const font = { id: "user_font_001", fileName: "user_font_001.ttf", displayName: "手持ちの字" };

beforeEach(() => {
  vi.mocked(listUserFonts).mockResolvedValue([font]);
  useProjectStore.setState({
    userFontIds: [font.id],
    fontError: null,
    refreshUserFonts: vi.fn(async () => {}),
    addUserFont: vi.fn(async () => null),
    removeUserFont: vi.fn(async () => true),
  } as never);
});
afterEach(() => vi.clearAllMocks());

describe("UserFontSection", () => {
  /**
   * ⚠️ **失敗を成功として知らせない**（α-6 出口監査 🟡13・§2-5）＝外せていないのに「外しました」を
   * 出すと、赤い理由と並ぶうえ**一覧にもそのまま残る**（何が起きたのか分からない）。
   */
  it("外せなかったら「外しました」と言わない", async () => {
    useProjectStore.setState({ removeUserFont: vi.fn(async () => false) } as never);
    render(<UserFontSection />);
    fireEvent.click(await screen.findByRole("button", { name: "外す" }));
    fireEvent.click(await screen.findByRole("button", { name: /外す/, hidden: false })); // 確認の「外す」
    await waitFor(() => expect(useProjectStore.getState().removeUserFont).toHaveBeenCalled());
    expect(screen.queryByText(/外しました/)).toBeNull();
  });

  it("外せたら、次にすることまで知らせる", async () => {
    render(<UserFontSection />);
    fireEvent.click(await screen.findByRole("button", { name: "外す" }));
    // ⚠️ **確認を通す**（α-6 出口監査 🟡27）＝1クリックでは消えない。
    expect(screen.getByText(/元に戻せません/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^外す$/ }));
    expect(await screen.findByText(/外しました/)).toBeInTheDocument();
    expect(screen.getByText(/書き出す前に選び直して/)).toBeInTheDocument();
  });

  // ⚠️ **うまくいった知らせを赤字の理由欄に載せない**（`/canon-check` ℹ️）＝
  // 会社の既定字体を外せたのは**成功**なので、`role="alert"` の理由として出すと失敗に見える。
  it("会社の見た目の指定も外したことは、理由ではなく知らせとして出す", async () => {
    useProjectStore.setState({ fontNotice: "この文字の形を外したので、会社の見た目の指定も外しました。設定の「会社の見た目」から選び直せます。", fontError: null } as never);
    render(<UserFontSection />);
    const msg = await screen.findByText(/会社の見た目の指定も外しました/);
    expect(msg).toBeInTheDocument();
    expect(msg.getAttribute("role")).not.toBe("alert");
    expect(msg.className).not.toContain("form-error");
  });
});
