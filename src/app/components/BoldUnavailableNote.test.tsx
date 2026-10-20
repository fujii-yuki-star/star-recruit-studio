// @vitest-environment jsdom
// 太さの欄の知らせ（#1483・ADR-0038）。
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoldUnavailableNote } from "./BoldUnavailableNote";
import { BOLD_UNAVAILABLE_NOTE } from "../uiLabels";

describe("BoldUnavailableNote", () => {
  it("持ち込みの字体なら「太字が効かない」と次の行動を出す", () => {
    render(<BoldUnavailableNote fontId="user_font_001" />);
    expect(screen.getByRole("note").textContent).toBe(BOLD_UNAVAILABLE_NOTE);
    expect(BOLD_UNAVAILABLE_NOTE).toContain("同梱の文字の形を選んで");
  });
  it("同梱の字体では何も出さない", () => {
    const { container } = render(<BoldUnavailableNote fontId="gen-interface-jp" />);
    expect(container.textContent).toBe("");
  });
});
