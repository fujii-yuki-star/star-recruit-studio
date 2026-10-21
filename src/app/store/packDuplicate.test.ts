// 拡張パックの見た目パターンを利用者の見た目パターンへ複製すると、パックの既定素材を利用者の素材へコピーして付け替える
//（パックを外しても複製が欠けない・ADR-0060 決定5 追補・PR レビュー 🟡）。取り込み口ではパックの名前を名乗らせない。
import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ imported: [] as string[], saved: [] as unknown[] }));
vi.mock("../../infrastructure/templateAssetFs", async (orig) => ({
  ...(await orig<typeof import("../../infrastructure/templateAssetFs")>()),
  importTemplateAsset: vi.fn(async (file: File) => {
    fx.imported.push(file.name);
    return { assetId: "tmpl_asset_007", url: "data:image/png;base64,COPY" };
  }),
}));
vi.mock("../../infrastructure/userTemplateFs", async (orig) => ({
  ...(await orig<typeof import("../../infrastructure/userTemplateFs")>()),
  saveUserTemplate: vi.fn(async (t: unknown) => { fx.saved.push(t); }),
}));

import { useProjectStore } from "./projectStore";
import { loadBundledTemplates, parseTemplateFiles } from "../../infrastructure/templateFs";
import type { Template } from "../../domain/template/types";

const packTemplate = (): Template => ({
  schemaVersion: "1.0", templateId: "pack_office__intro", name: "紹介", category: "opening", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 },
  layers: [
    { id: "bg", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0, fillColor: "#ffffff" },
    { id: "logo", type: "logo", x: 10, y: 10, w: 100, h: 100, zIndex: 1, assetId: "pack_office__logo" },
  ],
} as Template);

beforeEach(() => {
  // 一覧を同梱の分だけへ戻す（前の検査で足した見た目パターンを残さない）。
  useProjectStore.setState({ templates: loadBundledTemplates() });
  fx.imported = [];
  fx.saved = [];
  vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["x"], { type: "image/png" }) })));
});

describe("パックの見た目パターンの複製", () => {
  it("既定素材を利用者の素材へコピーして付け替える（パックの id を残さない）", async () => {
    const before = useProjectStore.getState().templates;
    useProjectStore.setState({
      templates: [...before, packTemplate()],
      templateAssetSrcById: { pack_office__logo: "data:image/png;base64,PACK" },
    });
    const id = await useProjectStore.getState().duplicateAsUserTemplate("pack_office__intro");
    expect(id).toMatch(/^user_tmpl_/);
    expect(fx.imported).toEqual(["pack_office__logo.png"]);
    const copy = useProjectStore.getState().templates.find((t) => t.templateId === id)!;
    expect(copy.layers[1]).toMatchObject({ assetId: "tmpl_asset_007" });
    expect(copy.layers[0]).not.toHaveProperty("assetId");
  });

  it("パックの素材が読めなければ複製しない（欠けた複製を作らない）", async () => {
    const before = useProjectStore.getState().templates;
    useProjectStore.setState({ templates: [...before, packTemplate()], templateAssetSrcById: {} });
    expect(await useProjectStore.getState().duplicateAsUserTemplate("pack_office__intro")).toBe("");
    expect(fx.saved).toEqual([]);
  });
});

describe("見た目パターンのファイルの取り込み", () => {
  it("パックの名前を名乗る・パックの素材を借りるものは断り、ほかは取り込む", async () => {
    const mine = { ...packTemplate(), templateId: "my_look", layers: [packTemplate().layers[0]] };
    const borrow = { ...packTemplate(), templateId: "my_borrow" };
    const files = [new File([JSON.stringify([packTemplate(), mine, borrow])], "looks.json", { type: "application/json" })];
    const r = await parseTemplateFiles(files);
    expect(r.templates.map((t) => t.templateId)).toEqual(["my_look"]);
    expect(r.rejected.map((x) => x.templateId)).toEqual(["pack_office__intro", "my_borrow"]);
  });

  it("store の取り込みでも入れない（2層目）", () => {
    const before = useProjectStore.getState().templates.length;
    useProjectStore.getState().addTemplatePack([packTemplate()]);
    expect(useProjectStore.getState().templates.length).toBe(before);
  });
});
