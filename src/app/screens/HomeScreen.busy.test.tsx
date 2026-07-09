// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { ProjectHeader } from "../../domain/project/persistence";
import { HomeScreen } from "./HomeScreen";

// #392：プロジェクトを開く最中は「開いています…」＋カード無効にし、連打・別プロジェクト並走で
// loadProject が後勝ちするのを防ぐ。開始中を pending 固定して観測する。
describe("HomeScreen プロジェクトを開く busy（#392）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("開いている間は「開いています…」＋カード無効（後勝ち防止）", async () => {
    useProjectStore.setState({
      listProjects: vi.fn(() =>
        Promise.resolve([{ projectId: "proj_001", projectName: "テスト動画", updatedAt: "2026-07-09T00:00:00Z" }] as unknown as ProjectHeader[]),
      ),
      loadProject: vi.fn(() => new Promise<void>(() => {})), // 永久 pending＝開いている最中を保つ
    });
    render(<HomeScreen onNavigate={vi.fn()} />);
    const card = (await screen.findByText("テスト動画")).closest("button") as HTMLButtonElement;
    fireEvent.click(card);
    expect(await screen.findByText("開いています…")).toBeTruthy();
    expect((screen.getByText("テスト動画").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
