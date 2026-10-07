// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { dragEnd, dragOver, pointerDownAt } from "../../test/pointer";
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

  /** その要素の「手前半分／後ろ半分」を指せるようにする（jsdom は実寸を持たない）。 */
  const halves = (el: Element) => {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    return { front: { clientX: 20, clientY: 20 }, back: { clientX: 80, clientY: 80 } };
  };

  it("先頭カードの持ち手を3枚目の**後ろ半分**へドラッグすると [002,003,001] になる", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual([
      "scene_001", "scene_002", "scene_003",
    ]);

    const cards = [...document.querySelectorAll(".scene-card")];
    expect(cards).toHaveLength(3);
    const grip = [...cards[0].querySelectorAll("span")].find((s) => s.textContent === "⠿");
    expect(grip).toBeTruthy();

    // 先頭カードの持ち手を掴み → 3枚目カードの**後ろ半分**（＝末尾のすき間）へ → window で離す。
    // ⚠️ **どちら半分かで結果が変わる**（#771(c)）＝落とし先は「重なったカード」ではなく**すき間**。
    const at = halves(cards[2]);
    pointerDownAt(grip as HTMLElement, 1000, { button: 0 });
    dragOver(cards[2], at.back);
    dragEnd();

    // 先頭 scene_001 が末尾へ動いた（＝ドラッグが実際に並べ替えを起こした）。
    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual([
      "scene_002", "scene_003", "scene_001",
    ]);
  });

  // ⚠️ **掴んだうえで**どのカードにも重ねずに離す＝「すき間が決まっていないなら並べ替えない」の経路。
  // 掴む前に離すと別の枝（ただのクリック）に入ってしまい、この守りを見たことにならない。
  it("掴んで運んでも、どのカードにも重ねずに離せば並びは変わらない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const cards = [...document.querySelectorAll(".scene-card")];
    const grip = [...cards[0].querySelectorAll("span")].find((s) => s.textContent === "⠿");
    pointerDownAt(grip as HTMLElement, 1000, { button: 0 });
    dragOver(document.body, { clientX: 400, clientY: 400 }); // カードの外まで運ぶ＝すき間が決まらない
    dragEnd();
    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual([
      "scene_001", "scene_002", "scene_003",
    ]);
  });

  // ⚠️ #714-4 の配線確認：作法（`usePointerDrag`）は共通部品で試験済みなので、ここで見るのは
  // **この画面まで届いているか**。以前は中止できず、掴んだら離すまで戻れなかった。
  it("運んでいる途中に Escape でやめると並びは変わらない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const cards = [...document.querySelectorAll(".scene-card")];
    const grip = [...cards[0].querySelectorAll("span")].find((s) => s.textContent === "⠿");
    const at = halves(cards[2]);
    pointerDownAt(grip as HTMLElement, 1000, { button: 0 });
    dragOver(cards[2], at.back);
    fireEvent.keyDown(window, { key: "Escape" });
    dragEnd(); // やめた後に離しても確定しない
    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual([
      "scene_001", "scene_002", "scene_003",
    ]);
  });

  // #771(c) の本題：**同じすき間なら、どちらから来ても同じ結果**。以前は「重なったカード」で決めて
  // いたので、前へ動かすとその手前・後ろへ動かすとその後ろ＝同じ手つきが向きで1つずれた。
  // ⚠️ 場面カードは**横並び**（`axis: "x"`）なので、左右で半分を測る。
  it("**同じすき間なら向きに依らず同じ結果**（1つズレを作らない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const cards = () => [...document.querySelectorAll(".scene-card")];
    const gripOf = (el: Element) => [...el.querySelectorAll("span")].find((x) => x.textContent === "⠿") as HTMLElement;

    // 先頭（001）を「2枚目の右半分」＝002 と 003 の間へ。
    const at1 = halves(cards()[1]);
    pointerDownAt(gripOf(cards()[0]), 1000, { button: 0 });
    dragOver(cards()[1], at1.back);
    dragEnd();
    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual(["scene_002", "scene_001", "scene_003"]);

    // 末尾（003）を「同じすき間」＝いまの 002 と 001 の間へ。手前から来ても後ろから来ても、
    // 「指した2枚の間」に入る。
    const at2 = halves(cards()[0]);
    pointerDownAt(gripOf(cards()[2]), 9000, { button: 0 });
    dragOver(cards()[0], at2.back);
    dragEnd();
    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual(["scene_002", "scene_003", "scene_001"]);
  });
});
