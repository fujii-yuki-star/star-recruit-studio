// @vitest-environment jsdom
// 差し込み口に入れられる素材の絞り込み（#512 段3）。規則そのものは domain（`slotAssign.test.ts`）で
// 見ているが、**画面がその規則を通しているか**はここでしか分からない
//（タイムライン編集と規則を共有した差し替えで、片方だけ外れても domain のテストは緑のまま）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useProjectStore } from "../store/projectStore";
import type { Asset, Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

const template = {
  schemaVersion: "1.0", templateId: "tmpl_001", name: "テンプレ", category: "photo_intro", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [
    { id: "anySlot", type: "slot", x: 0, y: 0, w: 640, h: 1080, zIndex: 1 },
    { id: "photoOnly", type: "slot", slotType: "image", x: 640, y: 0, w: 640, h: 1080, zIndex: 2 },
    { id: "videoOnly", type: "slot", slotType: "video", x: 1280, y: 0, w: 640, h: 1080, zIndex: 3 },
    { id: "logo", type: "logo", x: 0, y: 0, w: 200, h: 100, zIndex: 4 },
  ],
} as unknown as Template;

const assets: Asset[] = [
  { assetId: "asset_img", assetType: "image", displayName: "写真A", filePath: "a.png" },
  { assetId: "asset_vid", assetType: "video", displayName: "動画B", filePath: "b.mp4" },
  { assetId: "asset_logo", assetType: "logo", displayName: "ロゴC", filePath: "c.png" },
] as unknown as Asset[];

const scene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro", templateId: "tmpl_001",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  }) as unknown as Scene;

/** その差し込み口の選択肢に出ている素材の名前。 */
function optionsOf(label: string): string[] {
  const select = screen.getByText(label).parentElement?.querySelector("select");
  return [...(select?.querySelectorAll("option") ?? [])]
    .map((o) => o.textContent ?? "")
    .filter((t) => t !== "" && !t.includes("なし") && !t.includes("選択"));
}

describe("SceneEditScreen 差し込み口の素材の絞り込み（#512 段3）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: [template],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene()],
      assets, editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("種別を決めていない差し込み口には写真と動画が出る", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const names = optionsOf("素材1");
    expect(names).toContain("写真A");
    expect(names).toContain("動画B");
    expect(names).not.toContain("ロゴC");
  });

  it("写真だけの差し込み口には動画が出ない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const names = optionsOf("素材2");
    expect(names).toContain("写真A");
    expect(names).not.toContain("動画B");
  });

  it("動画だけの差し込み口には写真が出ない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const names = optionsOf("素材3");
    expect(names).toContain("動画B");
    expect(names).not.toContain("写真A");
  });

  it("ロゴの枠にはロゴと写真だけ（動画は出ない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const names = optionsOf("ロゴ");
    expect(names).toContain("ロゴC");
    expect(names).toContain("写真A");
    expect(names).not.toContain("動画B");
  });
});
