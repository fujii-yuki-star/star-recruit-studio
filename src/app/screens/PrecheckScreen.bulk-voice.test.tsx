// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { PrecheckScreen } from "./PrecheckScreen";

// #547 P2-6：公開前チェックの「声を作成」は、押すと作成中になるだけで**何件中何件できたのかも、止める手段も**無かった
// （たたき台・場面編集には進捗があるのにここだけ無い＝ADR-0026②）。共通操作に寄せたことを固定する。
const scene = (id: string, order: number, status: Scene["narration"]["status"]): Scene =>
  ({
    sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "こんにちは", status }, warnings: [],
  }) as Scene;

const setup = (scenes: Scene[]) => {
  useProjectStore.setState({
    templates: sampleTemplates,
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: scenes.map((s) => s.sceneId) }],
    scenes,
    assets: [],
    status: "ready",
    isGeneratingNarration: false,
    narrationCancelled: false,
    exportRun: { ...useProjectStore.getState().exportRun, phase: "idle" },
    autoGenerateIfSafe: vi.fn(async () => {}), // 画面 mount の自動生成は本テストの対象外
  });
};

describe("PrecheckScreen 声の作成に進捗と中止を出す（#547 P2-6）", () => {
  let origAuto: () => Promise<void>;
  beforeEach(() => {
    origAuto = useProjectStore.getState().autoGenerateIfSafe;
  });
  afterEach(() => {
    useProjectStore.setState({ autoGenerateIfSafe: origAuto });
    vi.restoreAllMocks();
  });

  it("未作成の場面があると、他画面と同じ「声 1/2」の進捗を出す", () => {
    setup([scene("scene_001", 1, "generated"), scene("scene_002", 2, "none")]);
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("声 1/2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "声を作成" })).toBeEnabled();
  });

  it("作成中は進捗が「作成中…」になり、止める手段（中止する）が出る", () => {
    setup([scene("scene_001", 1, "none"), scene("scene_002", 2, "none")]);
    useProjectStore.setState({ isGeneratingNarration: true });
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("声 0/2（作成中…）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中止する" })).toBeEnabled();
  });

  it("中止したあとも分数が残る＝作成済みの声が消えていないと分かる", () => {
    setup([scene("scene_001", 1, "generated"), scene("scene_002", 2, "none")]);
    useProjectStore.setState({ isGeneratingNarration: false, narrationCancelled: true });
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("声 1/2（中止しました）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "声を作成" })).toBeEnabled();
  });
});
