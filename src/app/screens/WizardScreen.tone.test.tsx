// @vitest-environment jsdom
// 採用の動画でも話し方の雰囲気（トーン）を選べる（2026-10-01 利用者判断・ADR-0052 追補10）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WizardScreen } from "./WizardScreen";
import { useProjectStore } from "../store/projectStore";
import { TONE_PRESETS } from "../../domain/constants";

describe("WizardScreen トーン（採用）", () => {
  const realApply = useProjectStore.getState().applyProjectInfo;
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
  });
  afterEach(() => useProjectStore.setState({ applyProjectInfo: realApply }));

  it("会社情報の画面にトーンの選択肢があり、選んだものが保存される", () => {
    const spy = vi.fn();
    useProjectStore.setState({ applyProjectInfo: spy });
    render(<WizardScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" })); // 種類/目的 → 会社情報（採用が既定）
    expect(screen.getByText("トーン（話し方の雰囲気）")).toBeTruthy();
    for (const t of TONE_PRESETS) expect(screen.getByRole("button", { name: t })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "フォーマル" }));
    expect(screen.getByRole("button", { name: "フォーマル", pressed: true })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/会社名/), { target: { value: "テスト株式会社" } });
    spy.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toMatchObject({ tone: "フォーマル", companyInfo: { companyName: "テスト株式会社" } });
  });
});
