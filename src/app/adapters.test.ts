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

  it("freeLayout が空配列でも自由配置の項目を出さない（要素ゼロは対象外）", () => {
    const items = buildPrecheckItems([freeScene([])], assets, [freeTemplate]);
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

describe("buildPrecheckItems（動画の配置 / #434・ADR-0026）", () => {
  const videoAsset: Asset = { assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "assets/v.mp4" };

  it("動画スロットを非表示にした場面（配置できない）は『動画の配置』が要対応で場面つき", () => {
    // 非表示スロット＝findVideoSlots は返すが layoutScene に出ず＝分割失敗＝黙って静止画化してはいけない状態。
    const scene = freeScene([
      { id: "slot_1", kind: "slot", x: 100, y: 100, w: 800, h: 600, assetId: "asset_v", fit: "cover", hidden: true },
    ] as unknown as Scene["freeLayout"]);
    const item = buildPrecheckItems([scene], [...assets, videoAsset], [freeTemplate]).find((i) => i.id === "videoPlacement");
    expect(item?.severity).toBe("action");
    expect(item?.detail).toContain("場面1");
  });

  it("配置できる動画スロットなら『動画の配置』項目は出さない（ノイズ回避）", () => {
    const scene = freeScene([
      { id: "slot_1", kind: "slot", x: 100, y: 100, w: 800, h: 600, assetId: "asset_v", fit: "cover" },
    ]);
    const item = buildPrecheckItems([scene], [...assets, videoAsset], [freeTemplate]).find((i) => i.id === "videoPlacement");
    expect(item).toBeUndefined();
  });
});

describe("buildPrecheckItems（#400・項目 action が該当場面へ飛ぶ sceneId）", () => {
  const videoAsset: Asset = { assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "assets/v.mp4" };
  const scn = (id: string, over: Partial<Scene> = {}): Scene => ({ ...freeScene([]), sceneId: id, ...over });

  it("声が無い項目は最初の該当場面 id を持つ（場面1固定でない）", () => {
    const a = scn("a", { narration: { text: "", status: "generated" } });
    const b = scn("b", { narration: { text: "", status: "none" } });
    const voice = buildPrecheckItems([a, b], assets, [freeTemplate]).find((i) => i.id === "voice");
    expect(voice?.severity).toBe("action");
    expect(voice?.sceneId).toBe("b"); // 2つ目が最初の該当
  });

  it("字幕が長い項目は最初の該当場面 id を持つ（action で飛べる項目）", () => {
    const a = scn("a", { texts: { subtitle: "短い字幕" } });
    const b = scn("b", { texts: { subtitle: "あ".repeat(61) } }); // > 既定60字
    const sub = buildPrecheckItems([a, b], assets, [freeTemplate]).find((i) => i.id === "subtitle");
    expect(sub?.severity).toBe("action");
    expect(sub?.sceneId).toBe("b");
  });

  it("問題が無い（ok）項目は sceneId を持たない", () => {
    const a = scn("a", { narration: { text: "", status: "generated" } });
    const voice = buildPrecheckItems([a], assets, [freeTemplate]).find((i) => i.id === "voice");
    expect(voice?.severity).toBe("ok");
    expect(voice?.sceneId).toBeUndefined();
  });

  it("動画の配置は最初の配置不能場面 id を持つ", () => {
    const ok = freeScene([{ id: "slot_1", kind: "slot", x: 0, y: 0, w: 100, h: 100, assetId: "asset_v", fit: "cover" }]);
    const bad = { ...freeScene([{ id: "slot_1", kind: "slot", x: 0, y: 0, w: 100, h: 100, assetId: "asset_v", fit: "cover", hidden: true } as unknown as NonNullable<Scene["freeLayout"]>[number]]), sceneId: "bad" } as Scene;
    const item = buildPrecheckItems([{ ...ok, sceneId: "ok1" } as Scene, bad], [...assets, videoAsset], [freeTemplate]).find((i) => i.id === "videoPlacement");
    expect(item?.sceneId).toBe("bad");
  });
});
