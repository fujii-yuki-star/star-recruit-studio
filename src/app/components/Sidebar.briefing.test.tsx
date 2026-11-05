// @vitest-environment jsdom
// あなた向け会社説明（β・ADR-0061 決定1）は、拡張パックの鍵があるときだけ左の帯に出る。
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

const base = { current: "home" as const, currentProjects: [], onCollapse: () => {} };

describe("左の帯：あなた向け会社説明", () => {
  it("鍵が無ければ出さない（通常のすたりおには出さない）", () => {
    render(<Sidebar {...base} onNavigate={() => {}} />);
    expect(screen.queryByRole("button", { name: "あなた向け会社説明" })).toBeNull();
  });

  it("鍵があれば「設定」の前に出て、押すとその画面へ", () => {
    const nav = vi.fn();
    render(<Sidebar {...base} onNavigate={nav} briefingEnabled />);
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names.indexOf("あなた向け会社説明")).toBe(names.indexOf("設定") - 1);
    expect(names.indexOf("見た目パターン")).toBeLessThan(names.indexOf("あなた向け会社説明"));
    fireEvent.click(screen.getByRole("button", { name: "あなた向け会社説明" }));
    expect(nav).toHaveBeenCalledWith("briefing");
  });
});
