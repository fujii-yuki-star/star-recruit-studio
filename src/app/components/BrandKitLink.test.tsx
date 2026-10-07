// @vitest-environment jsdom
// 「会社の見た目」への入口（#1032）。設定画面の奥だけにあり、素材・見た目を選んでいるときに辿れなかった。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { MaterialsScreen } from "../screens/MaterialsScreen";
import { LooksScreen } from "../screens/LooksScreen";
import { BRAND_KIT_LINK_LABEL, BrandKitLink } from "./BrandKitLink";

describe("会社の見た目への入口（#1032）", () => {
  beforeEach(() => {
    useProjectStore.getState().setSettingsFocus(null);
  });

  it("押すと設定へ移り、行き先の欄まで指定する（押しても目的の欄が見えない、を作らない）", () => {
    const onNavigate = vi.fn();
    render(<BrandKitLink onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: BRAND_KIT_LINK_LABEL }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
    expect(useProjectStore.getState().settingsFocus, "行き先の欄を指定していない").toBe("brandKit");
  });

  it("押す言葉に技術用語を出さない（§2-3）", () => {
    render(<BrandKitLink onNavigate={vi.fn()} />);
    const btn = screen.getByRole("button", { name: BRAND_KIT_LINK_LABEL });
    expect(btn.textContent).not.toMatch(/ブランドキット|アセット|brand/i);
  });
});

// ⚠️ **置いただけでは届かない**（α-6 出口監査 🔴1 と同じ型）＝部品を作っても
// **画面へ配線し忘れればどこからも押せない**ので、実際に描いて確かめる。
describe("会社の見た目への入口は、実際に両方の画面に出ている（#1032）", () => {
  beforeEach(() => {
    useProjectStore.getState().setSettingsFocus(null);
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: [] }],
      scenes: [], assets: [], status: "ready", saveStatus: "saved",
    });
  });

  it("素材を管理", () => {
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: BRAND_KIT_LINK_LABEL })).toBeInTheDocument();
  });

  it("見た目パターンを管理", () => {
    render(<LooksScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: BRAND_KIT_LINK_LABEL })).toBeInTheDocument();
  });
});
