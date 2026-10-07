// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// PR #1368 レビュー 🟡：場面形式の「動きの感じ」は「なめらか／一定」だけ。文書に**選択肢に無い名前つき**
// （止める＝#1365・ゆっくり始まる／終わる）が入っていると、表示は「なめらか」に見えるのに動きは別のまま、になっていた。
// ＝自由なカーブと同じく、欄を押せなくして一文を出す（作り直す値は元のまま）。

const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

const scene = {
  sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
  durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
  narration: { text: "", status: "none" },
  freeLayout: [{ id: "free_001", kind: "shape", x: 100, y: 100, w: 200, h: 200, zIndex: 1 }],
  warnings: [],
} as unknown as Scene;

const open = (easing: unknown) => {
  const st = useProjectStore.getState();
  useProjectStore.setState({
    templates: [freeTemplate],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [scene], assets: [], editingSceneId: "scene_001",
    meta: { ...st.meta, timelineOverlay: { animations: [{ id: "anim_001", sceneId: "scene_001", targetId: "free_001",
      keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 0.6, opacity: 1, easing }] }] } } as never,
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
  render(<SceneEditScreen onNavigate={vi.fn()} />);
  const btn = screen.getAllByRole("button").find((b) => b.hasAttribute("aria-pressed") && /^図形/.test(b.textContent ?? ""));
  fireEvent.click(btn!);
};

/** 「動きの感じ」の欄（見出しが欄に結び付いていないので、見出しの隣の選択欄で引く）。 */
const easingSelect = (): HTMLSelectElement =>
  screen.getByText("動きの感じ").parentElement!.querySelector("select") as HTMLSelectElement;

describe("場面形式の「動きの感じ」：選択肢に無い動き方（PR #1368）", () => {
  it("止める（hold）は欄を押せなくし、タイムライン編集で直すよう言う", () => {
    open("hold");
    const sel = easingSelect();
    expect(sel.disabled).toBe(true);
    expect(screen.getByText(/ここでは選べない動き方が設定されています/)).toBeTruthy();
  });

  it("選択肢にある動き方（一定）は選べる", () => {
    open("linear");
    const sel = easingSelect();
    expect(sel.disabled).toBe(false);
  });
});
