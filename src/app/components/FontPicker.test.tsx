// @vitest-environment jsdom
// 文字の形の選択（#161／持ち込みフォント＝ADR-0038・#261）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { FontPicker } from "./FontPicker";
import { useProjectStore } from "../store/projectStore";
import { FONT_CATALOG } from "../../domain/font/fontCatalog";

const userFonts = [
  { id: "user_font_001", fileName: "user_font_001.ttf", displayName: "会社の明朝" },
  { id: "user_font_002", fileName: "user_font_002.otf", displayName: "手書き風" },
];

beforeEach(() => useProjectStore.setState({ userFonts: [] } as never));
afterEach(() => vi.restoreAllMocks());

describe("FontPicker", () => {
  it("同梱の文字の形を選べる（従来どおり）", () => {
    render(<FontPicker value={null} onChange={vi.fn()} allowInherit />);
    fireEvent.click(screen.getByRole("button", { name: /動画全体に合わせる/ }));
    for (const f of FONT_CATALOG) expect(screen.getByText(f.label)).toBeInTheDocument();
  });

  /**
   * ⚠️ **取り込んだ文字の形が選べないと #261 は動いていない**（α-6 出口監査 🔴1）＝
   * 設定は「場面や文字の設定から選べます」と成功として案内するのに、一覧に出てこなかった。
   */
  it("手持ちの文字の形も一覧に出て、選べる", () => {
    useProjectStore.setState({ userFonts } as never);
    const onChange = vi.fn();
    render(<FontPicker value={null} onChange={onChange} allowInherit />);
    fireEvent.click(screen.getByRole("button", { name: /動画全体に合わせる/ }));
    expect(screen.getByText("会社の明朝")).toBeInTheDocument();
    fireEvent.click(screen.getByText("手書き風"));
    expect(onChange).toHaveBeenCalledWith("user_font_002");
  });

  /**
   * ⚠️ **持ち込みフォントも「既知」として扱う**（🔴1）＝以前は `FONT_CATALOG` だけを見ていたため、
   * 既に入っている値を**実際とは違う字体名**で見せ、一度触ると黙って上書きしていた。
   */
  it("いま選ばれている手持ちの文字の形を、その名前で見せる", () => {
    useProjectStore.setState({ userFonts } as never);
    render(<FontPicker value={"user_font_001" as never} onChange={vi.fn()} allowInherit />);
    expect(screen.getByRole("button", { name: /会社の明朝/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /動画全体に合わせる/ })).not.toBeInTheDocument();
  });

  /** ⚠️ 一覧を取れていなくても、**同梱は選べる**（行き止まりにしない）。 */
  it("手持ちが1つも無ければ同梱だけを出す", () => {
    render(<FontPicker value={null} onChange={vi.fn()} allowInherit />);
    fireEvent.click(screen.getByRole("button", { name: /動画全体に合わせる/ }));
    expect(screen.queryByText("（手持ち）")).not.toBeInTheDocument();
    expect(screen.queryByText("手書き風")).not.toBeInTheDocument();
  });
});
