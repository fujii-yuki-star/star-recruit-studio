// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { PreviewScreen } from "./PreviewScreen";

// #392：場面ゼロ（たたき台未作成で入った等）は、壊れて見える空プレビューではなく作成導線を出す。
describe("PreviewScreen 場面ゼロの空状態（#392）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject(); // 0 場面のクリーン状態
  });

  it("場面が無いときは空状態＋「新しい動画を作る」導線（onNavigate wizard）", () => {
    const onNavigate = vi.fn();
    render(<PreviewScreen onNavigate={onNavigate} />);
    expect(screen.getByText("まだ場面がありません")).toBeTruthy();
    fireEvent.click(screen.getByText("新しい動画を作る"));
    expect(onNavigate).toHaveBeenCalledWith("wizard");
  });
});
