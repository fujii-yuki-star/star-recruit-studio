// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmScreen } from "./ConfirmScreen";
import { useProjectStore } from "../store/projectStore";

// #423：送信前確認（ConfirmScreen）の「キャンセル」戻り先を confirmReturnTo で一般化した挙動を検証する（§2-6・ADR-0014）。
describe("ConfirmScreen キャンセルの戻り先（#423・§2-6）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" }); // newProject のガードを外す
    useProjectStore.getState().newProject();
    useProjectStore.getState().setConfirmReturnTo(null); // テスト間の持ち越しを防ぐ
  });

  it("既定（confirmReturnTo 未設定）はキャンセルでウィザードへ戻る", () => {
    const onNavigate = vi.fn();
    render(<ConfirmScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onNavigate).toHaveBeenCalledWith("wizard");
  });

  it("confirmReturnTo='draft'（作り直す起点）はキャンセルでたたき台へ戻る", () => {
    useProjectStore.getState().setConfirmReturnTo("draft");
    const onNavigate = vi.fn();
    render(<ConfirmScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onNavigate).toHaveBeenCalledWith("draft");
  });

  it("マウント時に confirmReturnTo を消費して持ち越さない（一度きりのペイロード）", () => {
    useProjectStore.getState().setConfirmReturnTo("draft");
    render(<ConfirmScreen onNavigate={vi.fn()} />);
    expect(useProjectStore.getState().confirmReturnTo).toBeNull();
  });
});
