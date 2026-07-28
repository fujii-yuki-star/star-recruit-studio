// @vitest-environment jsdom
// 一覧が**形式で行き先を分ける**（ADR-0032・11 §1）＝開いてから「形式が違う」と断らない。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HomeScreen } from "./HomeScreen";
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";
import * as fsMod from "../../infrastructure/projectFs";

const loadProject = vi.fn();
const openTimelineProject = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  loadProject.mockReset().mockResolvedValue(undefined);
  openTimelineProject.mockReset().mockResolvedValue(undefined);
  useProjectStore.setState({ loadProject, scenes: [], assets: [], parts: [], saveStatus: "saved" });
  useTimelineStore.setState({ openTimelineProject });
  vi.spyOn(fsMod, "listProjectSummaries").mockResolvedValue([
    { projectId: "proj_20260701_001", projectName: "場面の動画", updatedAt: "2026-07-01T00:00:00.000Z" },
    { projectId: "proj_20260728_001", projectName: "タイムラインの動画", updatedAt: "2026-07-28T00:00:00.000Z", format: "timeline" },
  ]);
});

describe("HomeScreen：形式で開く先を分ける", () => {
  it("タイムライン形式は専用の画面へ（場面形式の読込を通さない）", async () => {
    const onNavigate = vi.fn();
    render(<HomeScreen onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByText("タイムラインの動画"));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("timeline-project"));
    expect(openTimelineProject).toHaveBeenCalledWith("proj_20260728_001");
    expect(loadProject).not.toHaveBeenCalled();
  });

  it("場面形式は今までどおり（たたき台へ）", async () => {
    const onNavigate = vi.fn();
    render(<HomeScreen onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByText("場面の動画"));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("draft"));
    expect(loadProject).toHaveBeenCalledWith("proj_20260701_001");
    expect(openTimelineProject).not.toHaveBeenCalled();
  });

  it("どちらの作り方の動画か一覧で分かる", async () => {
    render(<HomeScreen onNavigate={vi.fn()} />);
    expect(await screen.findByText("タイムライン")).toBeInTheDocument();
  });

  it("タイムライン形式を開くときは「編集内容が失われます」の確認を出さない（実際は失われない）", async () => {
    // 場面側に未保存の作りかけがある状態。
    useProjectStore.setState({
      scenes: [{ sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro", templateId: "t", durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {}, narration: { text: "", status: "none" }, warnings: [] }],
      saveStatus: "idle",
    });
    const onNavigate = vi.fn();
    render(<HomeScreen onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByText("タイムラインの動画"));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("timeline-project"));
    expect(screen.queryByText(/保存していない素材や場面は失われます/)).not.toBeInTheDocument();
  });
});
