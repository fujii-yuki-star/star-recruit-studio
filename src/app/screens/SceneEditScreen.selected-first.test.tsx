// @vitest-environment jsdom
// 選んでいるものを先に見せる（#1032）。
//
// ⚠️ 自由配置の**編集カード**は、重ね順一覧・グループ・一括操作の**あと**にあり、
//    選んだ直後に**下へ長くスクロール**しないと目的の欄へ届かなかった（実測：要素5つで節だけ 3492px）。
//    ADR-0033 の既定も「再生位置と選んだ部品を同時に見られる」なので、そちらへ揃える。
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

const freeScene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
    freeLayout: [
      { id: "free_001", kind: "shape", x: 0, y: 0, w: 100, h: 100, zIndex: 1 },
      { id: "free_002", kind: "shape", x: 200, y: 0, w: 100, h: 100, zIndex: 2 },
    ],
  } as unknown as Scene);

/** キャンバスで 1 つ選ぶ（既定は「選んだ要素だけ編集」なので、選ばないとカードが出ない）。 */
function selectFirstElement(): void {
  const el = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
  expect(el, "キャンバスに要素が出ていない").not.toBeNull();
  fireEvent.pointerDown(el, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(el, { pointerId: 1 });
}

/** 節の中で、その文字が何番目に出てくるか（先にあるほど小さい）。 */
function orderOf(section: HTMLElement, text: string): number {
  const i = (section.textContent ?? "").indexOf(text);
  expect(i, `「${text}」が節の中に無い`).toBeGreaterThanOrEqual(0);
  return i;
}

describe("場面編集：選んでいるものを先に見せる（#1032）", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.setState({
      templates: [freeTemplate],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [freeScene()], assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("編集カードは、重ね順一覧・グループ・一括操作よりも先にある", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFirstElement();
    const section = (screen.getAllByText("自由配置").find((e) => e.closest("summary")) as HTMLElement).closest("details") as HTMLElement;
    expect(section, "「自由配置」の節が無い").not.toBeNull();
    // 編集カードの中にしか無い欄（位置の数値）を目印にする。
    const card = orderOf(section, "横位置");
    expect(card, "編集カードが重ね順一覧より後ろにある").toBeLessThan(orderOf(section, "（上が手前）"));
  });

  it("要素を足す入口は、いちばん上のまま（先に置いてから選ぶ、の順を崩さない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFirstElement();
    const section = (screen.getAllByText("自由配置").find((e) => e.closest("summary")) as HTMLElement).closest("details") as HTMLElement;
    expect(orderOf(section, "見た目パーツ")).toBeLessThan(orderOf(section, "横位置"));
  });
});
