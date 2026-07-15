// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

// 同時開始（掛け合いの並行・ADR-0031）：2人目以降の行に「前のセリフと同時に流す」トグルを出す。
const dialogueScene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" },
    lines: [
      { lineId: "line_001", text: "やあ", startSec: 2, status: "none" },
      { lineId: "line_002", text: "どうも", startSec: 5, status: "none" },
    ],
    warnings: [],
  }) as unknown as Scene;

describe("SceneEditScreen 同時開始トグル（ADR-0031）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [dialogueScene()],
      assets: [],
      editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("2人目のセリフだけにトグルを出す（先頭は同時にする相手がいない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("switch", { name: "前のセリフと同時に流す" })).toHaveLength(1);
  });

  it("ONで startWithPrevious=true＋開始秒クリア、再クリックで解除（Undo 可＝履歴に乗る）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch", { name: "前のセリフと同時に流す" }));
    const l2 = useProjectStore.getState().scenes[0].lines![1];
    expect(l2.startWithPrevious).toBe(true);
    expect(l2.startSec).toBeUndefined(); // 同時開始では開始秒を使わない＝クリア（意味の二重化防止）
    // 履歴に積まれる（Undo 可）。
    expect(useProjectStore.getState().past.length).toBeGreaterThan(0);
    // 再クリックで解除（フィールドを残さない）。
    fireEvent.click(screen.getByRole("switch", { name: "前のセリフと同時に流す" }));
    expect(useProjectStore.getState().scenes[0].lines![1].startWithPrevious).toBeUndefined();
  });

  it("ONのとき開始秒の入力欄は隠す（同時開始が優先＝設定できるのに効かない誤認を防ぐ）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    // 初期は2行とも逐次＝開始秒欄が2つ（両行）。
    expect(screen.getAllByText("開始（場面の頭から）")).toHaveLength(2);
    fireEvent.click(screen.getByRole("switch", { name: "前のセリフと同時に流す" }));
    // 2人目がONになると2人目の開始秒欄は消える（先頭のみ残る）。
    expect(screen.getAllByText("開始（場面の頭から）")).toHaveLength(1);
  });
});
