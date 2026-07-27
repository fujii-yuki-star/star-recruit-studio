// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { ExportResultNotice } from "./ExportResultNotice";

// #589：書き出しは他画面へ移動したまま走る（15 §4）。終端で編集ロックのバナーが消えるだけだと
// 「消えた＝成功して終わった」と誤読し、離席中の失敗に気づけない。終わったことを他画面でも知らせる。
describe("ExportResultNotice（書き出しの終了通知・#589）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
  });

  it("走行中は出さない（終わっていない）", () => {
    useProjectStore.getState().setExportRun({ phase: "rendering" });
    const { container } = render(<ExportResultNotice onNavigate={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("完了したら知らせる（他画面にいる利用者向け）", () => {
    useProjectStore.getState().setExportRun({ phase: "done" });
    render(<ExportResultNotice onNavigate={vi.fn()} />);
    expect(screen.getByText(/動画の書き出しが終わりました/)).toBeTruthy();
  });

  it("失敗は読み上げにも割り込ませ、理由を見に行く導線を出す（§2-5）", () => {
    useProjectStore.getState().setExportRun({ phase: "error", message: "保存先を選べませんでした。" });
    const { container } = render(<ExportResultNotice onNavigate={vi.fn()} />);
    expect(screen.getByText(/書き出しに失敗しました/)).toBeTruthy();
    expect(container.querySelector('[role="alert"]')).not.toBeNull(); // 見落とすと手戻りが大きい
  });

  it("中止も知らせる（成功と区別する）", () => {
    useProjectStore.getState().setExportRun({ phase: "cancelled" });
    render(<ExportResultNotice onNavigate={vi.fn()} />);
    expect(screen.getByText(/中止しました/)).toBeTruthy();
  });

  it("「書き出しの画面へ」で移動できる", () => {
    useProjectStore.getState().setExportRun({ phase: "done" });
    const onNavigate = vi.fn();
    render(<ExportResultNotice onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "書き出しの画面へ" }));
    expect(onNavigate).toHaveBeenCalledWith("export");
  });

  it("「閉じる」で消え、以後は出ない（既読＝古い通知を残さない・#547 P3-11 の教訓）", () => {
    useProjectStore.getState().setExportRun({ phase: "done" });
    const { container, rerender } = render(<ExportResultNotice onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    rerender(<ExportResultNotice onNavigate={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(useProjectStore.getState().exportRun.resultUnseen).toBe(false);
  });

  it("次の書き出しを始めると未読は落ちる（前回の結果を持ち越さない）", () => {
    useProjectStore.getState().setExportRun({ phase: "done" });
    expect(useProjectStore.getState().exportRun.resultUnseen).toBe(true);
    useProjectStore.getState().setExportRun({ phase: "rendering" });
    expect(useProjectStore.getState().exportRun.resultUnseen).toBe(false);
  });

  it("進捗だけの更新では未読状態を変えない（phase を含まない patch）", () => {
    useProjectStore.getState().setExportRun({ phase: "done" });
    useProjectStore.getState().setExportRun({ progress: { done: 1, total: 2 } });
    expect(useProjectStore.getState().exportRun.resultUnseen).toBe(true);
  });
});
