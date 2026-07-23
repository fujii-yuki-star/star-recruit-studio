// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #547 P2-6：場面編集の上部バーも、たたき台・公開前チェックと同じ共通操作（進捗・作成・中止）を使う。
// この画面はもともと進捗だけ持っていて中止が無く、しかも表示が「準備中…」で他画面（「作成中…」）とずれていた。
// 差し替えを外しても既存テストは全て緑のままだったため、配線そのものをここで固定する。
const scene = (id: string, order: number, status: Scene["narration"]["status"]): Scene =>
  ({
    sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "こんにちは", status }, warnings: [],
  }) as unknown as Scene;

const setup = (scenes: Scene[]) => {
  useProjectStore.setState({
    templates: sampleTemplates,
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: scenes.map((s) => s.sceneId) }],
    scenes,
    assets: [],
    editingSceneId: scenes[0]?.sceneId ?? null,
    isGeneratingNarration: false,
    narrationCancelled: false,
    exportRun: { ...useProjectStore.getState().exportRun, phase: "idle" },
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
};

describe("SceneEditScreen 声の作成の進捗と中止（#547 P2-6）", () => {
  beforeEach(() => {
    setup([scene("scene_001", 1, "generated"), scene("scene_002", 2, "none")]);
  });

  it("未作成があると他画面と同じ「声 1/2」の進捗を出す", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("声 1/2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全場面の声を作成" })).toBeEnabled();
  });

  it("作成中は他画面と同じ「作成中…」になり（以前はここだけ「準備中…」）、止める手段が出る", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("声 1/2（作成中…）")).toBeInTheDocument();
    expect(screen.queryByText(/準備中…/)).toBeNull();
    expect(screen.getByRole("button", { name: "中止する" })).toBeEnabled();
  });

  it("中止したあとも分数が残る＝作成済みの声が消えていないと分かる", () => {
    useProjectStore.setState({ isGeneratingNarration: false, narrationCancelled: true });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("声 1/2（中止しました）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全場面の声を作成" })).toBeEnabled();
  });

  it("全部作成済みなら進捗は出さず、ボタンは押せない＋理由を出す（押しても何も起きない、を作らない）", () => {
    setup([scene("scene_001", 1, "generated")]);
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/^声 /)).toBeNull();
    const btn = screen.getByRole("button", { name: "全場面の声を作成" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringContaining("すべての場面の声が作成済み"));
  });
});
