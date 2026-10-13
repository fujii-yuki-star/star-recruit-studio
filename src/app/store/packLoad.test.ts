// 入っている拡張パックを読む（ADR-0060）。読めないパックは飛ばし、ほかは読む。
import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ manifests: [] as string[], texts: {} as Record<string, string>, urls: {} as Record<string, string> }));
vi.mock("../../infrastructure/packFs", () => ({
  listPackManifests: vi.fn(async () => fs.manifests),
  readPackText: vi.fn(async (packId: string, rel: string) => {
    const t = fs.texts[`${packId}/${rel}`];
    if (t == null) throw new Error("無い");
    return t;
  }),
  readPackDataUrl: vi.fn(async (packId: string, rel: string) => fs.urls[`${packId}/${rel}`] ?? "data:image/png;base64,AA"),
}));

import { readInstalledPacks } from "./packLoad";
import { useProjectStore } from "./projectStore";

const SHA = "a".repeat(64);
const manifest = (packId: string, name: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  schemaVersion: "1.0", packId, name, version: "1.0.0", publisher: "社内", minAppVersion: "0.5.0",
  contents: { templates: [{ file: "t/intro.json" }], templateAssets: [{ assetId: "logo", file: "a/logo.png" }] },
  files: [{ path: "t/intro.json", sha256: SHA }, { path: "a/logo.png", sha256: SHA }],
  licenses: [{ target: "templates", license: "社内利用" }, { target: "templateAssets", license: "社内利用" }],
  ...extra,
});
const template = JSON.stringify({
  schemaVersion: "1.0", templateId: "intro", name: "紹介", category: "opening", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 },
  layers: [{ id: "logo", type: "logo", x: 10, y: 10, w: 100, h: 100, zIndex: 1, assetId: "logo" }],
});

beforeEach(() => {
  fs.manifests = [];
  fs.texts = {};
  fs.urls = {};
});

describe("readInstalledPacks", () => {
  it("見た目パターンと既定素材を、パックの頭を付けて読む", async () => {
    fs.manifests = [manifest("office", "オフィス")];
    fs.texts["office/t/intro.json"] = template;
    fs.urls["office/a/logo.png"] = "data:image/png;base64,LOGO";
    const r = await readInstalledPacks();
    expect(r.manifests.map((m) => m.packId)).toEqual(["office"]);
    expect(r.templates.map((t) => t.templateId)).toEqual(["pack_office__intro"]);
    expect(r.templates[0].layers[0]).toMatchObject({ assetId: "pack_office__logo" });
    expect(r.assetUrls).toEqual({ pack_office__logo: "data:image/png;base64,LOGO" });
    expect(r.skipped).toEqual([]);
  });

  it("読めないパックは飛ばして名前を知らせ、ほかは読む（半端に混ぜない）", async () => {
    fs.manifests = [
      manifest("office", "オフィス"),
      "{\"name\":\"壊れたパック\"}",
      manifest("broken", "見た目が読めない"),
    ];
    fs.texts["office/t/intro.json"] = template;
    fs.texts["broken/t/intro.json"] = "{";
    const r = await readInstalledPacks();
    expect(r.manifests.map((m) => m.packId)).toEqual(["office"]);
    expect(r.templates.map((t) => t.templateId)).toEqual(["pack_office__intro"]);
    expect(Object.keys(r.assetUrls)).toEqual(["pack_office__logo"]);
    expect(r.skipped).toEqual(["壊れたパック", "見た目が読めない"]);
  });
});

describe("projectStore.loadPacks", () => {
  it("パック由来の分だけを差し替え、同梱・利用者の見た目パターンと素材には触らない", async () => {
    const before = useProjectStore.getState().templates;
    useProjectStore.setState({
      templateAssetSrcById: { tmpl_asset_001: "data:user", pack_old__logo: "data:old" },
      templates: [...before, { ...before[0], templateId: "pack_old__x" }],
    });
    fs.manifests = [manifest("office", "オフィス")];
    fs.texts["office/t/intro.json"] = template;
    await useProjectStore.getState().loadPacks();
    const s = useProjectStore.getState();
    expect(s.templates.filter((t) => t.templateId.startsWith("pack_")).map((t) => t.templateId)).toEqual(["pack_office__intro"]);
    expect(s.templates.length).toBe(before.length + 1);
    expect(s.templateAssetSrcById).toEqual({ tmpl_asset_001: "data:user", pack_office__logo: "data:image/png;base64,AA" });
    expect(s.packs.map((m) => m.packId)).toEqual(["office"]);
  });
});

describe("projectStore.loadUserTemplates", () => {
  it("起動時の読み込みでパックも読む（別窓・本体の窓の両方がこの道）", async () => {
    fs.manifests = [manifest("office", "オフィス")];
    fs.texts["office/t/intro.json"] = template;
    await useProjectStore.getState().loadUserTemplates();
    const s = useProjectStore.getState();
    expect(s.templates.some((t) => t.templateId === "pack_office__intro")).toBe(true);
    expect(s.templateAssetSrcById.pack_office__logo).toBeDefined();
  });
});
