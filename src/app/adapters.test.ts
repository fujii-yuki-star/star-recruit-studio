import { describe, expect, it } from "vitest";
import type { Asset, Scene } from "../domain/project/types";
import type { Template } from "../domain/template/types";
import { buildPrecheckItems } from "./adapters";

const freeTemplate: Template = {
  schemaVersion: "1.0",
  templateId: "free_canvas_v1",
  name: "自由配置",
  category: "free",
  aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 },
  defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
};

const assets: Asset[] = [
  { assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "a.png" },
];

function freeScene(freeLayout: Scene["freeLayout"]): Scene {
  return {
    sceneId: "scene_001",
    partId: "part_001",
    order: 1,
    sceneType: "free",
    templateId: "free_canvas_v1",
    durationSec: 8,
    assetRefs: {},
    character: { enabled: false, characterId: "yuko" },
    texts: {},
    narration: { text: "", status: "generated" },
    warnings: [],
    freeLayout,
  };
}

describe("buildPrecheckItems（自由配置 / ADR-0008 §8 結線）", () => {
  it("FREE 場面が無いプロジェクトでは自由配置の項目を出さない", () => {
    const items = buildPrecheckItems([freeScene(undefined)], assets, [freeTemplate]);
    expect(items.find((i) => i.id === "freeLayout")).toBeUndefined();
  });

  it("問題のある freeLayout（画面外）があると自由配置の項目が warning になる", () => {
    const scene = freeScene([
      { id: "free_001", kind: "shape", x: 3000, y: 0, w: 100, h: 100, shapeType: "rect" },
    ]);
    const item = buildPrecheckItems([scene], assets, [freeTemplate]).find((i) => i.id === "freeLayout");
    expect(item?.severity).toBe("warning");
  });

  it("問題のない freeLayout だけなら自由配置の項目は ok", () => {
    const scene = freeScene([
      { id: "free_001", kind: "slot", x: 100, y: 100, w: 800, h: 600, assetId: "asset_001", fit: "cover" },
    ]);
    const item = buildPrecheckItems([scene], assets, [freeTemplate]).find((i) => i.id === "freeLayout");
    expect(item?.severity).toBe("ok");
  });

  it("freeLayout 経由で使う素材は『使っていない素材』に数えない", () => {
    const scene = freeScene([
      { id: "free_001", kind: "slot", x: 100, y: 100, w: 800, h: 600, assetId: "asset_001", fit: "cover" },
    ]);
    const unused = buildPrecheckItems([scene], assets, [freeTemplate]).find((i) => i.id === "unused");
    expect(unused?.severity).toBe("ok"); // asset_001 は freeLayout で使用済み
  });
});
