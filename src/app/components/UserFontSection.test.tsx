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
    await waitFor(() => expect(useProjectStore.getState().removeUserFont).toHaveBeenCalled());
    expect(screen.queryByText(/外しました/)).toBeNull();
  });

  it("外せたら、次にすることまで知らせる", async () => {
    render(<UserFontSection />);
    fireEvent.click(await screen.findByRole("button", { name: "外す" }));
    expect(await screen.findByText(/外しました/)).toBeInTheDocument();
    expect(screen.getByText(/書き出す前に選び直して/)).toBeInTheDocument();
  });
});
