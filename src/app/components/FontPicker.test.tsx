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

  /**
   * ⚠️ **見つからない字体を、無関係な字体の名前で見せない**（PR #901 レビュー 🟡・§2-5）。
   * `isKnownFontId` は**形**しか見ないので、①起動直後でまだ一覧を取れていない
   * ②実体が消えている（`listUserFonts` は実体があるものだけ返す）の2つで
   * 「既知だが一覧に無い」が起きる。先頭へ倒すと**具体的に間違った名前**が出て、
   * 押した瞬間その字体で上書きされる（🔴1 で直した失敗と同型）。
   */
  it("一覧に無い手持ちの文字の形は、同梱の名前にすり替えない", () => {
    render(<FontPicker value={"user_font_003" as never} onChange={vi.fn()} allowInherit />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("見つかりません");
    for (const f of FONT_CATALOG) expect(btn.textContent).not.toContain(f.label);
  });

  /**
   * ⚠️ **内部の綴りは画面に出さない**（§2-3・PR #901 レビュー 🟡→α-6 出口監査 🟡 で徹底）＝
   * 「見つからない」系の既存 UI（素材・見た目パターン）は種別と状態までしか出さない。
   * ⚠️ **ホバーにも出さない**＝当初は「選び直せるように `title` へ残す」としていたが、
   * ホバーすれば一般の利用者にも見えるので、原則（識別子を出さない）と食い違っていた。
   */
  it("見つからないときは、内部の綴りをどこにも出さない（ホバーにも）", () => {
    render(<FontPicker value={"user_font_003" as never} onChange={vi.fn()} allowInherit />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).not.toContain("user_font_003");
    expect(btn.getAttribute("title")).not.toContain("user_font_003");
    expect(btn.getAttribute("title")).toContain("見つかりません"); // 状態は伝える
  });

  /** ⚠️ 一覧を取る前でも同じ（起動直後の窓）＝一時的でも間違った名前を見せない。 */
  it("起動直後（一覧が空）でも、同梱の名前へすり替えない", () => {
    useProjectStore.setState({ userFonts: [] } as never);
    render(<FontPicker value={"user_font_001" as never} onChange={vi.fn()} allowInherit />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("見つかりません");
    expect(btn.getAttribute("title")).not.toContain("user_font_001");
  });

  /** ⚠️ 一覧を取れていなくても、**同梱は選べる**（行き止まりにしない）。 */
  it("手持ちが1つも無ければ同梱だけを出す", () => {
    render(<FontPicker value={null} onChange={vi.fn()} allowInherit />);
    fireEvent.click(screen.getByRole("button", { name: /動画全体に合わせる/ }));
    // ⚠️ 以前ここに `queryByText("（手持ち）")` を書いていたが、`FontPicker` の note は括弧なしの
    // 「手持ち」なので**永久に一致しない＝一度も出ない検査**だった（再監査で発覚）。実際の綴りで見る。
    expect(screen.queryByText("手持ち")).not.toBeInTheDocument();
    expect(screen.queryByText("手書き風")).not.toBeInTheDocument();
  });
});
