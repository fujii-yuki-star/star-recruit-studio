// @vitest-environment jsdom
//
// 入力画面を開いたら、このパソコンの中で動画案を作る部品を裏で起動しておく（ADR-0052 決定6・#1293）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import * as aiClient from "../../infrastructure/aiClient";
import * as appSettings from "../../infrastructure/appSettings";
import { useProjectStore } from "../store/projectStore";
import { WizardScreen } from "./WizardScreen";

describe("WizardScreen 先に準備する", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
  });

  it("このパソコンの中で作る設定なら、開いたときに1回だけ準備を頼む（待たない）", () => {
    vi.spyOn(appSettings, "getAiEngine").mockReturnValue(appSettings.AI_ENGINE.local);
    const prepare = vi.spyOn(aiClient, "prepareLocalAi").mockResolvedValue();
    const { rerender } = render(<WizardScreen onNavigate={() => {}} />);
    rerender(<WizardScreen onNavigate={() => {}} />);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("Gemini を選んでいるなら準備しない（このパソコンの部品を無駄に起こさない）", () => {
    vi.spyOn(appSettings, "getAiEngine").mockReturnValue(appSettings.AI_ENGINE.gemini);
    const prepare = vi.spyOn(aiClient, "prepareLocalAi").mockResolvedValue();
    render(<WizardScreen onNavigate={() => {}} />);
    expect(prepare).not.toHaveBeenCalled();
  });
});
