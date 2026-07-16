// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #529：FREE の文字/字幕要素に背景帯（可読性の下地）を付けられる。通常テンプレ字幕層の layer.background と同じ UX。
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

const firstEl = () => useProjectStore.getState().scenes[0].freeLayout![0];

describe("SceneEditScreen FREE 背景帯（#529）", () => {
  beforeEach(() => setup(freeScene({ freeLayout: [{ id: "free_001", kind: "text", x: 0, y: 0, w: 200, h: 60, text: "あ" }] } as Partial<Scene>)));

  it("文字要素の背景帯トグルON で background.enabled=true になり、色/濃さの詳細が現れる", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("背景色")).toBeNull(); // OFF のときは色/濃さ/角丸は隠れている
    const sw = screen.getByRole("switch", { name: "背景帯を付ける" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(firstEl().background?.enabled).toBe(true);
    expect(screen.getByRole("switch", { name: "背景帯を付ける" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("背景色")).toBeInTheDocument(); // ON で色/濃さ/角丸が出る
  });

  it("字幕要素にも背景帯トグルがある（文字と同じ下地）", () => {
    setup(freeScene({ freeLayout: [{ id: "free_001", kind: "subtitle", x: 0, y: 0, w: 200, h: 60 }] } as Partial<Scene>));
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch", { name: "背景帯を付ける" }));
    expect(firstEl().background?.enabled).toBe(true);
  });

  it("図形要素には背景帯トグルを出さない（文字/字幕だけの下地）", () => {
    setup(freeScene({ freeLayout: [{ id: "free_001", kind: "shape", x: 0, y: 0, w: 200, h: 60, shapeType: "rect", fillColor: "#000000" }] } as Partial<Scene>));
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("switch", { name: "背景帯を付ける" })).toBeNull();
  });
});
