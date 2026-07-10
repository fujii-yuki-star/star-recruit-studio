// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import { StartNewVideoButton } from "./StartNewVideoButton";

// #413：空状態の「新しい動画を作る」もヘッダ/ホームと同じ破棄ガード付きリセットに統一。
// 未保存が無ければ即ウィザード（確認なし＝従来の空状態と同じ）／未保存があれば確認を挟んでからリセット→ウィザード。
const scene = (id: string): Scene =>
  ({
    sceneId: id, partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "tpl", durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" },
    texts: {}, narration: { text: "", status: "none" }, warnings: [],
  }) as unknown as Scene;

describe("StartNewVideoButton（新規作成の破棄ガード統一・#413）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
  });

  it("未保存の作業が無ければ確認なしで即ウィザードへ（従来の空状態と同じ挙動）", () => {
    useProjectStore.setState({ scenes: [], assets: [], saveStatus: "saved" });
    const onNavigate = vi.fn();
    render(<StartNewVideoButton onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("新しい動画を作る"));
    expect(onNavigate).toHaveBeenCalledWith("wizard");
    expect(screen.queryByText("新しく作る")).toBeNull(); // 確認は出ない
  });

  it("未保存の作業があれば確認を挟み、『新しく作る』でリセット→ウィザード", () => {
    useProjectStore.setState({ scenes: [scene("scene_001")], assets: [], saveStatus: "idle" });
    const onNavigate = vi.fn();
    render(<StartNewVideoButton onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("新しい動画を作る"));
    expect(onNavigate).not.toHaveBeenCalled(); // まず確認（黙って捨てない）
    fireEvent.click(screen.getByText("新しく作る"));
    expect(onNavigate).toHaveBeenCalledWith("wizard");
    expect(useProjectStore.getState().scenes.length).toBe(0); // リセットされた
  });

  it("確認で『やめる』を押すとボタンに戻り、遷移もリセットもしない", () => {
    useProjectStore.setState({ scenes: [scene("scene_001")], assets: [], saveStatus: "idle" });
    const onNavigate = vi.fn();
    render(<StartNewVideoButton onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("新しい動画を作る"));
    fireEvent.click(screen.getByText("やめる"));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByText("新しい動画を作る")).toBeTruthy(); // ボタンに戻る
    expect(useProjectStore.getState().scenes.length).toBe(1); // 保持（リセットしない）
  });
});
