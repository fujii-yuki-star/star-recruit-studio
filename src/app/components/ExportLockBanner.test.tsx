// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ExportPhase } from "../store/projectStore";
import { useProjectStore } from "../store/projectStore";
import { ExportLock, ExportLockBanner } from "./ExportLockBanner";

// #570 P2：書き出し中はバナーを出すだけでなく、囲んだ編集 UI を inert で実際に操作不可にする（「押せるのに効かない」を無くす）。
const setExport = (phase: ExportPhase) =>
  useProjectStore.setState({ exportRun: { phase, progress: { done: 0, total: 0 }, resultPath: "", message: "", bgmWarning: "", cancelling: false } });

describe("ExportLockBanner / ExportLock（#570 P2）", () => {
  afterEach(() => setExport("idle"));

  it("書き出しでない：バナー無し・子は inert で囲まれない（従来どおり操作可）", () => {
    setExport("idle");
    render(<ExportLock><button>編集ボタン</button></ExportLock>);
    expect(screen.queryByText(/書き出し中は編集できません/)).toBeNull();
    expect(screen.getByText("編集ボタン").closest("[inert]")).toBeNull();
  });

  it("書き出し中：バナーを出し、子を inert 部分木で囲む（操作不可）", () => {
    setExport("rendering");
    render(<ExportLock><button>編集ボタン</button></ExportLock>);
    expect(screen.getByText(/書き出し中は編集できません/)).toBeTruthy();
    expect(screen.getByText("編集ボタン").closest("[inert]")).not.toBeNull();
  });

  it("ExportLockBanner 単体：書き出し中だけ表示（encoding も真）", () => {
    setExport("encoding");
    const { rerender } = render(<ExportLockBanner />);
    expect(screen.getByText(/書き出し中は編集できません/)).toBeTruthy();
    setExport("done");
    rerender(<ExportLockBanner />);
    expect(screen.queryByText(/書き出し中は編集できません/)).toBeNull();
  });
});
