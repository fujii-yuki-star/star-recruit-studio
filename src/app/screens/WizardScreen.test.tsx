// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WizardScreen } from "./WizardScreen";
import { useProjectStore } from "../store/projectStore";

// #401 の主眼＝ウィザードの離脱時コミットと、完了時の二重コミット防止をコンポーネントで検証する（ADR-0014・jsdom）。
describe("WizardScreen 入力保護（#401）", () => {
  const realApply = useProjectStore.getState().applyProjectInfo;

  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" }); // newProject のガードを外す
    useProjectStore.getState().newProject(); // 空の新規状態・step0 から
  });
  afterEach(() => {
    useProjectStore.setState({ applyProjectInfo: realApply }); // 上書きした action を戻す
  });

  it("会社名を入力して離脱すると、その内容が applyProjectInfo で store に確定される（離脱コミット）", () => {
    const spy = vi.fn();
    useProjectStore.setState({ applyProjectInfo: spy });
    const { unmount } = render(<WizardScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" })); // step0(種類/目的)→step1(会社情報)
    fireEvent.change(screen.getByLabelText("会社名"), { target: { value: "テスト株式会社" } });
    spy.mockClear(); // ここまでの commit は除き、離脱(unmount)時の挙動だけを見る
    unmount();
    expect(spy).toHaveBeenCalledTimes(1); // 離脱で1回だけ確定される
    expect(spy.mock.calls[0][0].companyInfo.companyName).toBe("テスト株式会社");
  });

  it("会社名入力→次へ（確定）直後に離脱しても二重に applyProjectInfo しない（#401 レビュー・二重発火防止）", () => {
    const spy = vi.fn();
    useProjectStore.setState({ applyProjectInfo: spy });
    const { unmount } = render(<WizardScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" })); // step0→1
    fireEvent.change(screen.getByLabelText("会社名"), { target: { value: "テスト株式会社" } });
    fireEvent.click(screen.getByRole("button", { name: "次へ" })); // step1→2：ここで1回 commit
    const afterCommit = spy.mock.calls.length;
    expect(afterCommit).toBeGreaterThan(0);
    unmount(); // 確定後に編集していない＝スナップショット一致で離脱コミットを skip
    expect(spy.mock.calls.length).toBe(afterCommit); // 増えない＝pushHistory の二重積みが起きない
  });

  it("入力せず（空フォームで）離脱しても applyProjectInfo を呼ばない（無駄な dirty/履歴を作らない）", () => {
    const spy = vi.fn();
    useProjectStore.setState({ applyProjectInfo: spy });
    const { unmount } = render(<WizardScreen onNavigate={() => {}} />);
    unmount(); // 何も入力していない＝会社名/テーマ空＝確定しない
    expect(spy).not.toHaveBeenCalled();
  });
});
