// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { dragEnd, dragOver, pointerDownAt } from "../../test/pointer";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #714-4 レビュー：並べ替えも `Escape` でやめられるようになったので、**同じ 1 回の `Escape` で 2 段はがれる**
// 経路が生まれた（運ぶのをやめる＋開いている欄が閉じる）。`06 §12.1`＝**手前のものから1段ずつはがす**。
//
// ⚠️ ここで見るのは**共存**（掴んだ状態で欄が開いている）＝仕組み（`usePointerDrag` の中止）と
// 画面の後始末（ポップオーバー）が別々に window を購読しているので、片方だけ見ても分からない。

const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

const freeScene = (id: string, order: number): Scene =>
  ({
    sceneId: id, partId: "part_001", order, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" },
    freeLayout: [{ id: "free_001", kind: "shape", x: 100, y: 100, w: 200, h: 200, zIndex: 1 }],
    warnings: [],
  }) as unknown as Scene;

describe("Escape は手前のものから1段ずつはがす（#714-4 レビュー）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: [freeTemplate],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      scenes: [freeScene("scene_001", 1), freeScene("scene_002", 2)],
      assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  const order = () => useProjectStore.getState().scenes.map((s) => s.sceneId);

  /** 右クリック→「編集」で kind 別エディタの欄を開く（この画面で `Escape` を待っているもの）。 */
  const openEditPopover = (): void => {
    const box = document.querySelector('[data-free-id="free_001"]') ?? screen.getAllByRole("button")[0];
    fireEvent.contextMenu(box, { clientX: 200, clientY: 200 });
    fireEvent.click(screen.getByText("編集"));
  };

  /** 場面カードの持ち手（横並び）。 */
  const gripOfFirstCard = (): HTMLElement => {
    const card = document.querySelectorAll(".scene-card")[0];
    (card as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    return [...card.querySelectorAll("span")].find((s) => s.textContent === "⠿") as HTMLElement;
  };

  it("運んでいる最中の Escape は「やめる」だけに効き、開いている欄は閉じない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    openEditPopover();
    expect(screen.getByRole("dialog", { name: /を編集/ })).toBeInTheDocument();

    const cards = [...document.querySelectorAll(".scene-card")];
    (cards[1] as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    pointerDownAt(gripOfFirstCard(), 1000, { button: 0 });
    dragOver(cards[1], { clientX: 80, clientY: 80 });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(order()).toEqual(["scene_001", "scene_002"]); // 運ぶのはやめた
    expect(screen.getByRole("dialog", { name: /を編集/ })).toBeInTheDocument(); // 欄は開いたまま
    dragEnd();
  });

  it("掴んでいないときの Escape はいままでどおり欄を閉じる（塞ぎっぱなしにしない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    openEditPopover();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /を編集/ })).toBeNull();
  });
});
