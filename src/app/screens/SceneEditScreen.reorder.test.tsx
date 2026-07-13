// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #398 再対応：場面編集のカードは <button> で、当初 handleProps を button 直掛けにしていたため
// ネイティブ HTML5 DnD の dragstart が発火せず「掴めるのに並ばない」不具合だった。Pointer Events 版へ
// 置換したうえで、持ち手（⠿）を実操作（pointerdown→他カードへ pointermove→window pointerup）して
// store の並びが本当に変わることを固定する（画面上のドラッグ未検証の解消）。
function scene(id: string, order: number): Scene {
  return {
    sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  };
}

describe("SceneEditScreen 場面カードの並び替え（Pointer Events・#398 再対応）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002", "scene_003"] }],
      scenes: [scene("scene_001", 1), scene("scene_002", 2), scene("scene_003", 3)],
      assets: [],
      editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("先頭カードの持ち手を3枚目へドラッグすると store の並びが [002,003,001] になる", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual([
      "scene_001", "scene_002", "scene_003",
    ]);

    const cards = [...document.querySelectorAll(".scene-card")];
    expect(cards).toHaveLength(3);
    const grip = [...cards[0].querySelectorAll("span")].find((s) => s.textContent === "⠿");
    expect(grip).toBeTruthy();

    // 先頭カードの持ち手を掴み → 3枚目カード（index 2）へ重ね → window で離す＝実操作相当。
    fireEvent.pointerDown(grip as HTMLElement, { button: 0 });
    fireEvent.pointerMove(cards[2]);
    fireEvent.pointerUp(window);

    // 先頭 scene_001 が末尾へ動いた（＝ドラッグが実際に並べ替えを起こした）。
    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual([
      "scene_002", "scene_003", "scene_001",
    ]);
  });

  it("持ち手を掴んで同じ場所で離す（他カードに重ねない）と並びは変わらない＝クリック相当", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const cards = [...document.querySelectorAll(".scene-card")];
    const grip = [...cards[0].querySelectorAll("span")].find((s) => s.textContent === "⠿");
    fireEvent.pointerDown(grip as HTMLElement, { button: 0 });
    fireEvent.pointerUp(window); // どのカードにも重ねずに離す
    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual([
      "scene_001", "scene_002", "scene_003",
    ]);
  });
});
