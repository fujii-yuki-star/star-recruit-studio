// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #547 P2-4：FREE の「重ね順」一覧も**描画順の反転**で並べる。
// 描画（renderer/layout）は昇順・安定ソート＝**同 z は配列の後ろが手前**。一覧を単純な降順ソートにすると
// 同 z のとき前後が逆に出て、↑↓が1段にならない（押しても動かない／2段飛ぶ）。
// 同 z は通常→FREE 変換（ADR-0030）で実際に生じる：`sceneOps` が実効 z を写すため、見出し/本文がどちらも 30 になる。
const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

// 同じ zIndex の2要素。配列順は free_001 → free_002 なので、描画では **free_002 が手前**。
// 自動名は配列順の連番＝free_001「図形1」/ free_002「図形2」。
const tiedScene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" },
    freeLayout: [
      { id: "free_001", kind: "shape", x: 100, y: 100, w: 200, h: 200, zIndex: 30 },
      { id: "free_002", kind: "shape", x: 400, y: 100, w: 200, h: 200, zIndex: 30 },
    ],
    warnings: [],
  }) as unknown as Scene;

describe("SceneEditScreen FREE 重ね順一覧の並び（#547 P2-4）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: [freeTemplate],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [tiedScene()],
      assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("同じ z のときも描画どおりの前後で並ぶ（配列の後ろが手前＝一覧の上）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const rows = screen
      .getAllByTitle("クリックで選択・ダブルクリックで名前を変更（Shift＋クリックで複数選択）")
      .map((b) => b.textContent ?? "");
    // 降順ソートだと配列順のまま「図形1, 図形2」になり、描画（図形2 が手前）と上下が逆になる。
    expect(rows).toEqual(["図形2", "図形1"]);
  });
});
