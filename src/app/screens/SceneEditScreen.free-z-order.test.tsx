// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

/** 一覧の行（上＝手前）の表示名。 */
const rowNames = (): string[] =>
  screen
    .getAllByTitle("クリックで選択・ダブルクリックで名前を変更（Shift＋クリックで複数選択）")
    .map((b) => b.textContent ?? "");

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
    // 降順ソートだと配列順のまま「図形1, 図形2」になり、描画（図形2 が手前）と上下が逆になる。
    expect(rowNames()).toEqual(["図形2", "図形1"]);
  });

  // #587：同 z の1段移動は**配列を入れ替える**。自動名を配列位置で振っていると、上げただけで名前が入れ替わって見える。
  it("1段動かしても自動名は入れ替わらない（順番だけが変わる）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(rowNames()).toEqual(["図形2", "図形1"]);
    // 一覧で下にある「図形1」を前面へ＝上下が入れ替わる。名前は付いてこない。
    fireEvent.click(screen.getByRole("button", { name: "図形1を前面へ" }));
    expect(rowNames()).toEqual(["図形1", "図形2"]);
    const els = useProjectStore.getState().scenes[0].freeLayout!;
    expect(els.map((e) => e.zIndex)).toEqual([30, 30]); // z は増やさない＝階層へ食い込まない
    expect(els.map((e) => e.id)).toEqual(["free_002", "free_001"]); // 入れ替わったのは配列の順
  });
});
