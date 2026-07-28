// @vitest-environment jsdom
// 焼き出しの導線（ADR-0032 決定16/17・#628）。押した瞬間に作らない／範囲を変えたら確認をやり直す、を固定する。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BakeToTimelinePanel } from "./BakeToTimelinePanel";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";

function scene(id: string, partId = "part_001"): Scene {
  return {
    sceneId: id,
    partId,
    order: 1,
    sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1",
    durationSec: 8,
    assetRefs: {},
    character: { enabled: false, characterId: "yuko" },
    texts: {},
    narration: { text: "", status: "none" },
    warnings: [],
  };
}

const estimateBake = vi.fn();
const bakeToTimeline = vi.fn();

beforeEach(() => {
  estimateBake.mockReset().mockResolvedValue({ bytes: 12 * 1024 * 1024, notes: [] });
  bakeToTimeline.mockReset().mockResolvedValue({ projectId: "proj_20260728_001", notes: [] });
  useProjectStore.setState({
    meta: { ...useProjectStore.getState().meta, projectName: "採用動画" },
    parts: [
      { partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002"] },
      { partId: "part_002", title: "パート2", order: 2, sceneIds: [] },
    ],
    scenes: [scene("scene_001"), scene("scene_002"), scene("scene_003")],
    estimateBake,
    bakeToTimeline,
  });
});

describe("BakeToTimelinePanel", () => {
  it("元の動画が残ることを、押す前に伝える（片道・決定16）", () => {
    render(<BakeToTimelinePanel />);
    expect(screen.getByText(/いまの動画はそのまま残ります/)).toBeInTheDocument();
  });

  it("いきなり作らない＝まず内容を確かめ、増える容量を見せてから作る（決定13）", async () => {
    render(<BakeToTimelinePanel />);
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    await waitFor(() => expect(screen.getByText(/約 12MB増えます/)).toBeInTheDocument());
    expect(bakeToTimeline).not.toHaveBeenCalled(); // 確認しただけでは作らない

    fireEvent.click(screen.getByText("この内容で作る"));
    await waitFor(() => expect(screen.getByText(/を作りました/)).toBeInTheDocument());
    expect(bakeToTimeline).toHaveBeenCalledWith({ kind: "whole" }, "採用動画（タイムライン）");
  });

  it("持っていけないものを、作る前に見せる（§2-5）", async () => {
    estimateBake.mockResolvedValue({ bytes: 0, notes: [{ code: "BAKE_VIDEO_START_TIMING_SKIPPED", sceneNumbers: [2] }] });
    render(<BakeToTimelinePanel />);
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    await waitFor(() => expect(screen.getByText(/場面2：動画を再生し始めるタイミングは持っていけません/)).toBeInTheDocument());
  });

  it("範囲を変えたら確認をやり直させる（古い容量のまま作らせない）", async () => {
    render(<BakeToTimelinePanel />);
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    await waitFor(() => expect(screen.getByText("この内容で作る")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("どこまでを作り直しますか"), { target: { value: "part" } });
    expect(screen.queryByText("この内容で作る")).not.toBeInTheDocument();
    expect(screen.getByText("作る内容を確かめる")).toBeInTheDocument();
  });

  it("パートを選ぶと、そのパートだけを作る", async () => {
    render(<BakeToTimelinePanel />);
    fireEvent.change(screen.getByLabelText("どこまでを作り直しますか"), { target: { value: "part" } });
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    await waitFor(() => expect(estimateBake).toHaveBeenCalledWith({ kind: "part", partId: "part_001" }));
  });

  it("場面の範囲を選ぶと、両端を含む場面だけを作る", async () => {
    render(<BakeToTimelinePanel />);
    fireEvent.change(screen.getByLabelText("どこまでを作り直しますか"), { target: { value: "between" } });
    fireEvent.change(screen.getByLabelText("ここから"), { target: { value: "scene_002" } });
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    await waitFor(() =>
      expect(estimateBake).toHaveBeenCalledWith({ kind: "scenes", sceneIds: ["scene_002", "scene_003"] }),
    );
  });

  it("場面の入らない範囲では作らせない（中身の無い動画を作らない）", () => {
    render(<BakeToTimelinePanel />);
    fireEvent.change(screen.getByLabelText("どこまでを作り直しますか"), { target: { value: "part" } });
    fireEvent.change(screen.getByLabelText("パート"), { target: { value: "part_002" } }); // 空のパート
    expect(screen.getByText(/選んだ範囲に場面がありません/)).toBeInTheDocument();
    expect(screen.getByText("作る内容を確かめる")).toBeDisabled();
  });

  it("作成に失敗したら「次の行動」を出す（§2-5）", async () => {
    bakeToTimeline.mockRejectedValue(new Error("disk full"));
    render(<BakeToTimelinePanel />);
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    await waitFor(() => expect(screen.getByText("この内容で作る")).toBeInTheDocument());
    fireEvent.click(screen.getByText("この内容で作る"));
    await waitFor(() => expect(screen.getByText(/空き容量を確かめて、もう一度お試しください/)).toBeInTheDocument());
  });
});
