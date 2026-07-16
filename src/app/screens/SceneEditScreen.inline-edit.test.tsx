// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #549 配線：オーバーレイの「編集中」を画面が受け取り ScenePreview の hideItemIds へ渡す＝編集中はSVG側の同じ文字を
// 伏せる（textarea が同じ体裁で同じ位置に出すため、伏せないと二重表示になる）。単体テストは overlay/preview を
// 個別に props 注入で見るので、ここでは「画面経由の実経路」を通して配線の取り違えを検知する。
const freeScene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free",
    templateId: "free_canvas_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
    freeLayout: [
      { id: "free_001", kind: "text", x: 100, y: 100, w: 800, h: 200, text: "編集する文字", fontSize: 48 },
      { id: "free_002", kind: "text", x: 100, y: 400, w: 800, h: 200, text: "ほかの文字", fontSize: 48 },
    ],
  }) as unknown as Scene;

/** 仕上がりSVG（プレビュー）の中身だけを見る＝右パネルの入力欄や textarea の値と混ざらない。 */
const svgText = () => (document.querySelector('[aria-label="場面の仕上がり"]') as HTMLElement | null)?.textContent ?? "";

describe("SceneEditScreen インライン編集の配線（#549）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [freeScene()], assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("ダブルクリックで編集に入るとSVG側の同じ文字だけ伏せ、抜けると戻る（二重表示にしない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(svgText()).toContain("編集する文字"); // 編集前は描かれている

    const el = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
    const opts = { button: 0, clientX: 10, clientY: 10, pointerId: 1 };
    fireEvent.pointerDown(el, opts);
    fireEvent.pointerUp(el, { pointerId: 1 });
    fireEvent.pointerDown(el, opts); // 二度押し＝インライン編集へ（実機経路・#525-4）

    // 画面には他にも textbox（動画の名前・右パネル）があるため、要素ボックス内のインライン textarea を直接引く。
    const ta = document.querySelector('[data-free-id="free_001"] textarea') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.value).toBe("編集する文字"); // その場編集の入力面
    expect(svgText()).not.toContain("編集する文字"); // 編集中＝SVG からは伏せる（hideItemIds 配線）
    expect(svgText()).toContain("ほかの文字"); // 他の要素は描いたまま

    fireEvent.blur(ta);
    expect(svgText()).toContain("編集する文字"); // 編集を抜けたら戻る
  });
});
