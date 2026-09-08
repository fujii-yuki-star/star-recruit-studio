// @vitest-environment jsdom
// 自由配置の文字も、体裁は畳んで出す（#1032）。
//
// ⚠️ 通常の場面（「〜の見た目」）とタイムライン（「文字の体裁」）は既に畳んでいるのに、
//    自由配置のカードだけ開きっぱなしだった＝**同じものを場所で別の出し方にしない**（ADR-0026②）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

const sceneWith = (over: Record<string, unknown>): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
    freeLayout: [{ id: "free_001", kind: "text", x: 0, y: 0, w: 300, h: 80, zIndex: 1, text: "こんにちは", ...over }],
  } as unknown as Scene);

const setup = (s: Scene) => {
  useProjectStore.setState({
    templates: [freeTemplate],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [s], assets: [], editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
  render(<SceneEditScreen onNavigate={vi.fn()} />);
  const el = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
  expect(el, "キャンバスに要素が出ていない").not.toBeNull();
  fireEvent.pointerDown(el, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(el, { pointerId: 1 });
};

const lookSection = (): HTMLDetailsElement =>
  screen.getByText("文字の体裁").closest("details") as HTMLDetailsElement;

describe("自由配置の文字：体裁は畳んで出す（#1032）", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.setState({ past: [], future: [], _historyGroupDepth: 0 });
  });

  it("何も入れていなければ畳んで出す", () => {
    setup(sceneWith({}));
    expect(lookSection().open, "既定で開いている").toBe(false);
  });

  it("字間を入れてあれば開いて出す（入れた設定を見失わない）", () => {
    setup(sceneWith({ letterSpacing: 0.2 }));
    expect(lookSection().open, "入れてあるのに畳んでいる").toBe(true);
  });

  it("背景帯を付けてあれば開いて出す", () => {
    setup(sceneWith({ background: { enabled: true } }));
    expect(lookSection().open, "入れてあるのに畳んでいる").toBe(true);
  });

  // ⚠️ **3つの項目をそれぞれ見る**（PR #1081 レビューと同じ理由）＝代表だけだと、
  // **他の項を落とす変異が生き残る**（入れた設定が畳まれたままになる項目ができる）。
  it("影を付けてあれば開いて出す", () => {
    setup(sceneWith({ shadow: { enabled: true } }));
    expect(lookSection().open, "入れてあるのに畳んでいる").toBe(true);
  });

  // ⚠️ **選び直したら見直す**（`CollapsibleSection` の注記）＝`key` を付けないと
  // **最初に選んだものの開閉のまま固まる**（入れてあるのに畳まれたまま）。
  it("選び直すと、その要素に合わせて開閉を見直す", () => {
    useProjectStore.setState({
      templates: [freeTemplate],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [{
        sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
        durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
        narration: { text: "", status: "none" }, warnings: [],
        freeLayout: [
          { id: "free_001", kind: "text", x: 0, y: 0, w: 300, h: 80, zIndex: 1, text: "体裁なし" },
          { id: "free_002", kind: "text", x: 400, y: 0, w: 300, h: 80, zIndex: 2, text: "体裁あり", letterSpacing: 0.2 },
        ],
      }] as unknown as Scene[],
      assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const pick = (id: string): void => {
      const el = document.querySelector(`[data-free-id="${id}"]`) as HTMLElement;
      fireEvent.pointerDown(el, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerUp(el, { pointerId: 1 });
    };
    pick("free_001");
    expect(lookSection().open, "体裁が無いのに開いている").toBe(false);
    pick("free_002");
    expect(lookSection().open, "選び直しても前の開閉のまま").toBe(true);
  });

  it("色・太さ・フォント・揃えは畳まない（毎回触るもの）", () => {
    setup(sceneWith({}));
    expect(lookSection().textContent, "基本の欄まで畳んでいる").not.toContain("太さ");
    expect(screen.getByText("太さ")).toBeInTheDocument();
  });
});
