// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #565：FREE 要素の「縁取り/枠線」は太さだけ設定しても描かれず、色見本だけが黒を出していた
// （通常テンプレ層は resolveTextStyle が担保済みで、FREE 側にだけ穴があった）。
// ここでは**見本の色**と**仕上がりの絵**の両方を見る＝どちらか片方だけ直しても緑にならない（§2-7）。
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

/** 要素を選ぶ（「選択した要素だけ編集」が既定 ON＝選ばないとカードが無く、検査が空振りで緑になる）。 */
const selectFirst = () => {
  const el = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
  fireEvent.pointerDown(el, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(el, { pointerId: 1 });
};

/** 色見本（ColorPicker）を開いて、そこが出している色コードを読む。 */
function swatchValue(name: string): string {
  fireEvent.click(screen.getByRole("button", { name }));
  const v = (screen.getByLabelText("色コード") as HTMLInputElement).value;
  fireEvent.click(screen.getByRole("button", { name })); // 閉じる（次の検査と干渉しない）
  return v;
}

/** 仕上がりの絵（プレビュー SVG）。実 layoutScene の出力＝書き出しと同じ経路。 */
const previewSvg = () => (screen.getByLabelText("場面の仕上がり") as HTMLElement).innerHTML;

const textEl = (extra: Record<string, unknown>) =>
  freeScene({ freeLayout: [{ id: "free_001", kind: "text", x: 0, y: 0, w: 400, h: 120, text: "あ", fontSize: 40, ...extra }] } as Partial<Scene>);

describe("SceneEditScreen FREE の縁取り/枠線（#565）", () => {
  beforeEach(() => setup(textEl({})));

  it("太さだけ設定した文字は、仕上がりにも縁取りが出る（見本と同じ色）", () => {
    setup(textEl({ strokeWidth: 3 }));
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFirst();
    // 暗い文字（既定色）→ 白い縁取り。以前はここが「描かれない／見本は黒」だった。
    expect(previewSvg()).toContain('stroke="#ffffff"');
    expect(swatchValue("縁取りの色を選ぶ")).toBe("#ffffff");
  });

  it("白い文字なら縁取りの既定は黒（白い縁取りでは見えないまま＝直っていない）", () => {
    setup(textEl({ strokeWidth: 3, color: "#ffffff" }));
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFirst();
    expect(previewSvg()).toContain('stroke="#000000"');
    expect(swatchValue("縁取りの色を選ぶ")).toBe("#000000");
  });

  it("図形の枠線は塗りが下地（明るい塗り→黒枠・暗い塗り→白枠）", () => {
    setup(freeScene({ freeLayout: [{ id: "free_001", kind: "shape", x: 0, y: 0, w: 200, h: 200, shapeType: "rect", fillColor: "#eeeeee", strokeWidth: 5 }] } as Partial<Scene>));
    const view = render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFirst();
    expect(previewSvg()).toContain('stroke="#000000"');
    expect(swatchValue("枠線の色を選ぶ")).toBe("#000000");
    view.unmount();

    setup(freeScene({ freeLayout: [{ id: "free_001", kind: "shape", x: 0, y: 0, w: 200, h: 200, shapeType: "rect", fillColor: "#111111", strokeWidth: 5 }] } as Partial<Scene>));
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFirst();
    expect(previewSvg()).toContain('stroke="#ffffff"');
    expect(swatchValue("枠線の色を選ぶ")).toBe("#ffffff");
  });

  it("色を選んだあとはその色（既定に上書きされない）", () => {
    setup(textEl({ strokeWidth: 3, strokeColor: "#22c55e" }));
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFirst();
    expect(previewSvg()).toContain('stroke="#22c55e"');
    expect(swatchValue("縁取りの色を選ぶ")).toBe("#22c55e");
  });
});
