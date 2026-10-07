// @vitest-environment jsdom
// 文字の**影と字間**（#264）を書き込む入口（差分再監査 2巡目）。
//
// ⚠️ **入口が1つも無かった**＝schema・解決（`resolveTextStyle`）・描画・焼き出しまで land して
// いるのに、値を書ける画面がどこにも無く**利用者からは使えない**ままだった（🔴1 の持ち込みフォント・
// ADR-0036 のロゴに続く3例目＝「実装済みに見えて使えない」）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

const freeScene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free",
    templateId: "free_canvas_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "こんにちは", status: "none" }, warnings: [],
    freeLayout: [{ id: "free_001", kind: "text", x: 0, y: 0, w: 200, h: 60, text: "あ" }],
  }) as unknown as Scene;

beforeEach(() => {
  useProjectStore.setState({
    templates: sampleTemplates,
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [freeScene()], assets: [], editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
});

const firstEl = () => useProjectStore.getState().scenes[0].freeLayout![0];
const selectFirst = () => {
  const el = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
  fireEvent.pointerDown(el, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(el, { pointerId: 1 });
};

describe("SceneEditScreen FREE 文字の影と字間（#264）", () => {
  /** ⚠️ **字間は「文字サイズに対する割合」**＝サイズを変えても詰め具合が変わらない。 */
  it("字間を書き込める", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFirst();
    const input = screen.getByLabelText("字間");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "0.2" } });
    fireEvent.blur(input);
    expect(firstEl().letterSpacing).toBeCloseTo(0.2);
  });

  it("影を付けると、色・濃さ・ぼかし・ずれを触れる", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFirst();
    // OFF のときは詳細を出さない（背景帯と同じ作法）。
    expect(screen.queryByText("影の色")).toBeNull();
    const sw = screen.getByRole("switch", { name: "影を付ける" });
    fireEvent.click(sw);
    expect(firstEl().shadow?.enabled).toBe(true);
    expect(screen.getByText("影の色")).toBeInTheDocument();
    const blur = screen.getByLabelText("ぼかし");
    fireEvent.focus(blur);
    fireEvent.change(blur, { target: { value: "4" } });
    fireEvent.blur(blur);
    expect(firstEl().shadow?.blur).toBe(4);
  });
});
