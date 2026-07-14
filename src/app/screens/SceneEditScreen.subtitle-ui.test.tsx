// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { FreeElement, Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

// ADR-0029 PR-C：FREE 場面で「字幕」要素を追加でき、対象（subtitleSource）を選べる UI。
const freeScene = (partial: Partial<Scene> = {}): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free",
    templateId: "free_canvas_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "こんにちは", status: "none" }, warnings: [], ...partial,
  }) as unknown as Scene;

function setup(scene: Scene) {
  useProjectStore.setState({
    templates: sampleTemplates,
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [scene], assets: [], editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
}

const subtitles = (): FreeElement[] =>
  (useProjectStore.getState().scenes[0].freeLayout ?? []).filter((e) => e.kind === "subtitle");

describe("SceneEditScreen FREE 字幕の追加（ADR-0029・PR-C）", () => {
  beforeEach(() => setup(freeScene()));

  it("「字幕」を追加すると subtitle 要素が freeLayout に入る（文言なし＝対象から解決）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "字幕" }));
    const els = subtitles();
    expect(els).toHaveLength(1);
    expect(els[0].text).toBeUndefined(); // 表示文言は subtitleSource から解決＝el.text は持たない
    expect(els[0].subtitleSource).toBeUndefined(); // 既定＝後方互換
  });

  it("字幕は複数追加できる（「場面に1つ」制約は無い・ADR-0029）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    // 追加前は「字幕」ボタンは一意（追加後はレイヤー一覧等にも現れるため参照を使い回す）。安定した追加ボタン node を保持。
    const addBtn = screen.getByRole("button", { name: "字幕" });
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);
    expect(subtitles()).toHaveLength(2); // 単一制約なし＝複数配置できる
  });
});
