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

  // #590 で4画面の空状態を共有化：まだ何も無い（status "idle"）は「まだ動画案がありません」＝たたき台と同じ言い方。
  // 「まだ場面がありません」は**動画案はあるが場面が0**のときの文言（下のケース）。
  it("まだ動画案が無いときは空状態＋「新しい動画を作る」導線（onNavigate wizard）", () => {
    const onNavigate = vi.fn();
    render(<PreviewScreen onNavigate={onNavigate} />);
    expect(screen.getByText("まだ動画案がありません")).toBeTruthy();
    fireEvent.click(screen.getByText("新しい動画を作る"));
    expect(onNavigate).toHaveBeenCalledWith("wizard");
  });
});
