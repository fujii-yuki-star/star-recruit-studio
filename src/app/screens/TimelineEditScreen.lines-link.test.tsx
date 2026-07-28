// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { lineAudioKey } from "../../domain/project/narrationLines";
import type { Scene } from "../../domain/project/types";
import { TimelineEditScreen } from "./TimelineEditScreen";

// ADR-0023 段階(3)「lines 導線」：タイムラインで見つけたセリフ/字幕/場面から**編集元へ辿れる**ようにする。
// タイムライン側では書き換えない（正準は場面＝ADR-0018 の2モデル方式）ので、出すのは
// ①その場面の編集へ移る ②その場面の声を作り直す の2つだけ。
const scene = (id: string, order: number, over: Partial<Scene> = {}): Scene =>
  ({
    sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" },
    texts: {}, narration: { text: "", status: "none" }, warnings: [], ...over,
  }) as Scene;

/** タイムラインの帯（仕上がりプレビューにも同じ文言が出るので、タイムライン内に限定して引く）。 */
const clipBar = (text: string) => within(screen.getByTestId("timeline-view")).getAllByText(text)[0];
const panel = () => screen.getByTestId("scene-clip-editor");

describe("TimelineEditScreen 選んだ場面から編集元へ（ADR-0023 (3)・#329）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      scenes: [
        scene("scene_001", 1, {
          lines: [{ lineId: "line_001", text: "はじめまして", subtitleText: "はじめまして", status: "none" }],
        } as Partial<Scene>),
        scene("scene_002", 2),
      ],
      assets: [],
      narrationAudioById: { [lineAudioKey("scene_001", "line_001")]: "blob:a" },
      meta: { ...useProjectStore.getState().meta, timelineOverlay: undefined },
      editingSceneId: null,
      isGeneratingNarration: false,
      past: [], future: [], _historyGroupDepth: 0, status: "ready", saveStatus: "saved",
    });
  });

  it("セリフのクリップを選ぶと、その場面と文言が出て「この場面を編集する」で場面編集へ移る", () => {
    const onNavigate = vi.fn();
    render(<TimelineEditScreen onNavigate={onNavigate} />);
    // 何も選んでいないときは案内だけ。
    expect(screen.queryByTestId("scene-clip-editor")).not.toBeInTheDocument();

    fireEvent.click(clipBar("はじめまして"));
    expect(within(panel()).getByText(/場面 1/)).toBeInTheDocument();
    expect(within(panel()).getByText(/はじめまして/)).toBeInTheDocument(); // どのセリフを選んだか分かる

    fireEvent.click(within(panel()).getByText("この場面を編集する"));
    // 「どの場面を開くか」は store の一度きりのペイロードで渡す（#400 と同じ経路）。
    expect(useProjectStore.getState().editingSceneId).toBe("scene_001");
    expect(onNavigate).toHaveBeenCalledWith("scene-edit");
  });

  it("場面のクリップからも同じ導線が出る（セリフの無い場面でも辿れる）", () => {
    const onNavigate = vi.fn();
    render(<TimelineEditScreen onNavigate={onNavigate} />);
    fireEvent.click(clipBar("場面 2"));
    expect(within(panel()).getByText(/場面 2/)).toBeInTheDocument();
    fireEvent.click(within(panel()).getByText("この場面を編集する"));
    expect(useProjectStore.getState().editingSceneId).toBe("scene_002");
    expect(onNavigate).toHaveBeenCalledWith("scene-edit");
  });

  it("選んだ場面の声をその場で作り直せる", () => {
    const generateNarration = vi.fn(() => Promise.resolve());
    useProjectStore.setState({ generateNarration });
    render(<TimelineEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(clipBar("はじめまして"));
    fireEvent.click(within(panel()).getByText("この場面の声を作り直す"));
    expect(generateNarration).toHaveBeenCalledWith("scene_001");
  });

  it("声の作成中・書き出し中は「作り直す」を押せない（押せるのに効かない、を作らない）", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    render(<TimelineEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(clipBar("はじめまして"));
    expect(within(panel()).getByText("声を作成中…")).toBeDisabled();
  });

  it("テロップ（自分で足したもの）を選んだときは従来どおり文言の編集パネル", () => {
    render(<TimelineEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("＋ テロップを追加"));
    expect(screen.getByTestId("overlay-clip-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("scene-clip-editor")).not.toBeInTheDocument();
  });
});
