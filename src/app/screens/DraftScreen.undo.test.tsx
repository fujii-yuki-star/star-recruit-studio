// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { DraftScreen } from "./DraftScreen";

// #413：たたき台に取り消す/やり直すボタンを追加（削除/並べ替えも戻せる）。履歴の有無で有効/無効が切り替わり、
// 押すと store の undo/redo を呼ぶことを固定する。
const scene = (id: string, order: number): Scene =>
  ({
    sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  }) as unknown as Scene;

describe("DraftScreen 取り消す/やり直す（#413）", () => {
  let origUndo: () => void;
  let origRedo: () => void;
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    origUndo = useProjectStore.getState().undo;
    origRedo = useProjectStore.getState().redo;
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene("scene_001", 1)],
      status: "ready", warnings: [], past: [], future: [], saveStatus: "saved",
    });
  });
  afterEach(() => {
    useProjectStore.setState({ undo: origUndo, redo: origRedo });
    vi.clearAllMocks();
  });

  it("履歴が無いときは取り消す/やり直すが無効", () => {
    render(<DraftScreen onNavigate={vi.fn()} />);
    expect((screen.getByRole("button", { name: "取り消す" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "やり直す" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("履歴があれば取り消すが有効になり、押すと store の undo を呼ぶ", () => {
    const undo = vi.fn();
    useProjectStore.setState({ past: [{} as never], undo: undo as unknown as () => void }); // past 非空＝canUndo
    render(<DraftScreen onNavigate={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "取り消す" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
