// @vitest-environment jsdom
// 素材の取り込みボタンを共有部品へ置き換えたときの見た目（#712 レビュー）。
// 部品側のテストだけだと、**呼び出し側が見た目の指定を渡し忘れた**ことに気づけないので、画面で固定する。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

const template = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

const scene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, freeLayout: [], warnings: [],
  }) as unknown as Scene;

describe("SceneEditScreen 素材の取り込みボタン（#712）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: [template],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene()],
      assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("素材一覧の下で全幅・上の余白つきのまま（共有部品への置き換えで幅が縮まない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /素材を追加/ });
    // `.btn` は inline-flex なので `btn-block` が落ちると中身の幅に縮み、隣の「保存」等と並びが崩れる。
    expect(btn).toHaveClass("btn", "btn-secondary", "btn-block", "mt");
  });
});
