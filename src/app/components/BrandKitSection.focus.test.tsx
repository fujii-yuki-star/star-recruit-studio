// @vitest-environment jsdom
// 指定された欄まで寄る／寄ったら指定を落とす（#1032）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { BrandKitSection } from "./BrandKitSection";

describe("会社の見た目：指定された欄まで寄る（#1032）", () => {
  beforeEach(() => {
    useProjectStore.getState().setSettingsFocus(null);
  });

  it("指定されているときは寄り、寄ったら指定を落とす（次に開いたとき勝手に動かない）", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    useProjectStore.getState().setSettingsFocus("brandKit");
    render(<BrandKitSection onNavigate={vi.fn()} />);
    expect(scrollIntoView, "指定されているのに寄っていない").toHaveBeenCalled();
    expect(useProjectStore.getState().settingsFocus, "寄ったのに指定が残っている").toBeNull();
  });

  it("指定が無いときは寄らない（サイドバーから開いたら勝手にスクロールしない）", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<BrandKitSection onNavigate={vi.fn()} />);
    act(() => {});
    expect(scrollIntoView, "指定していないのに寄っている").not.toHaveBeenCalled();
  });
});
