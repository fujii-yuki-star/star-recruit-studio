// @vitest-environment jsdom
//
// 押すと開く「？」（使い勝手の点検 2026-10-22）。⚠️ **ホバーだけに置かない**（`06 §2` 規約20）＝押して開ける・札にも同じ文。
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HelpTip } from "./HelpTip";

describe("HelpTip", () => {
  it("名前（読み上げ）と札を持ち、押すと文が開く", () => {
    const { container } = render(<HelpTip label="動きの説明" text="空欄の項目は動かしません。" />);
    const summary = container.querySelector("summary")!;
    expect(summary.getAttribute("aria-label")).toBe("動きの説明");
    expect(summary.getAttribute("title")).toBe("空欄の項目は動かしません。");
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getByText("空欄の項目は動かしません。")).toBeInTheDocument();
  });
});
