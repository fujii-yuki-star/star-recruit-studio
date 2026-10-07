// @vitest-environment jsdom
import { doubleTap } from "../../test/pointer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #525-11：FREE 編集で選択中の要素を矢印キーで微調整（1px・Shift 10px）、Delete で削除できる。
// 入力欄にフォーカス中は無効（数値欄やテキスト編集を邪魔しない）。
const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

const freeScene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" },
    freeLayout: [{ id: "free_001", kind: "shape", x: 100, y: 100, w: 50, h: 50, zIndex: 1 }],
    groups: [], warnings: [],
  }) as unknown as Scene;

describe("SceneEditScreen キーボード操作（#525-11）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: [freeTemplate],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [freeScene()],
      assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  const el = () => useProjectStore.getState().scenes[0].freeLayout?.[0];
  const selectFree001 = () => {
    const box = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
    fireEvent.pointerDown(box, { button: 0, clientX: 120, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(box, { pointerId: 1 });
  };

  it("矢印キーで選択要素が1px動く（Shift で10px）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFree001();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(el()?.x).toBe(101); // +1
    fireEvent.keyDown(document.body, { key: "ArrowDown", shiftKey: true });
    expect(el()?.y).toBe(110); // +10
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(el()?.x).toBe(100); // -1（元へ）
  });

  it("何も選択していないと矢印で動かない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(el()?.x).toBe(100); // 選択なし＝動かない
  });

  it("入力欄にフォーカス中は矢印で動かさない（数値欄/テキスト編集を邪魔しない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFree001();
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowRight" }); // target が入力欄＝無視
    expect(el()?.x).toBe(100);
    input.remove();
  });

  // ⚠️ #788 レビュー 🔴：共有部品へ抜いたとき、旧実装の「`SELECT`／全 `INPUT` を除外」がいったん落ちた。
  // この画面は要素を選ぶとセレクト（形・揃え・動き…）とスライダーが並ぶので、譲らないと
  // **欄の値が変わらないまま部品だけ動く**／**欄を触っているつもりで部品が消える**。
  it("セレクトやスライダーに焦点があるときは矢印を奪わない（欄の値が変わらず部品だけ動く、を作らない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFree001();
    for (const make of [
      () => document.createElement("select"),
      () => Object.assign(document.createElement("input"), { type: "range" }),
      () => Object.assign(document.createElement("input"), { type: "number" }),
    ]) {
      const node = make();
      document.body.appendChild(node);
      expect(fireEvent.keyDown(node, { key: "ArrowRight" })).toBe(true); // 奪わない
      expect(el()?.x).toBe(100);
      node.remove();
    }
  });

  it("セレクトやチェックボックスに焦点があるときは Delete で部品を消さない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFree001();
    for (const make of [
      () => document.createElement("select"),
      () => Object.assign(document.createElement("input"), { type: "checkbox" }),
    ]) {
      const node = make();
      document.body.appendChild(node);
      fireEvent.keyDown(node, { key: "Delete" });
      expect(el()).toBeTruthy(); // 消えていない
      node.remove();
    }
  });

  // ⚠️ **変換中は奪わない**の配線（共通判定は単体試験済みだが、繋がっているかは未検証だった）。
  it("日本語を変換している最中は矢印を奪わない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFree001();
    fireEvent.keyDown(document.body, { key: "ArrowRight", isComposing: true });
    expect(el()?.x).toBe(100);
  });

  it("Delete で単一選択要素を削除する", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFree001();
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(useProjectStore.getState().scenes[0].freeLayout?.length).toBe(0);
  });

  it("ロック要素はキーボード Delete で消さない（移動と同じ流儀・#525-11 レビュー P3）", () => {
    useProjectStore.setState((s) => ({
      scenes: s.scenes.map((sc) => sc.sceneId === "scene_001"
        ? { ...sc, freeLayout: sc.freeLayout?.map((e) => e.id === "free_001" ? { ...e, locked: true } : e) }
        : sc),
    }));
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectFree001(); // ロック要素も選択はできる（右クリック/一覧解除用）
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(useProjectStore.getState().scenes[0].freeLayout?.length).toBe(1); // 消えない
  });

  it("変形グループのドリルインメンバーは矢印で動かさない（canvas select-only・#542 と一貫・#525-11 レビュー P2）", () => {
    // free_001 を scale=2 のグループに入れる。
    useProjectStore.setState((s) => ({
      scenes: s.scenes.map((sc) => sc.sceneId === "scene_001"
        ? { ...sc, groups: [{ id: "group_001", members: ["free_001"], transform: { x: 0, y: 0, rotation: 0, scale: 2 } }] }
        : sc),
    }));
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const box = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
    // ダブルクリック（pointerdown×2）でドリルイン＝そのメンバーを個別選択。
    doubleTap(box, { clientX: 120, clientY: 120 });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(el()?.x).toBe(100); // 変形グループのメンバーは動かさない（詳細パネルで編集）
  });
});
