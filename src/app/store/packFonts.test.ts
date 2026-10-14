// 拡張パックの文字の形（ADR-0060 段階2）を、持ち込みと同じ一覧へ合流する。
import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ manifests: [] as string[], userFonts: [] as { id: string; fileName: string; displayName: string }[] | null, loaded: [] as string[] }));
vi.mock("../../infrastructure/packFs", () => ({
  listPackManifests: vi.fn(async () => fx.manifests),
  readPackText: vi.fn(async () => { throw new Error("無い"); }),
  readPackDataUrl: vi.fn(async () => "data:font/otf;base64,AA"),
}));
vi.mock("../../infrastructure/userFontFs", async (orig) => ({
  ...(await orig<typeof import("../../infrastructure/userFontFs")>()),
  listUserFonts: vi.fn(async () => fx.userFonts),
  loadUserFonts: vi.fn(async (ids: readonly string[]) => { fx.loaded.push(...ids); }),
}));

import { useProjectStore } from "./projectStore";
import { packFontIds, setPackFontSources } from "../../infrastructure/userFontFs";

const SHA = "a".repeat(64);
const fontPack = (packId: string) => JSON.stringify({
  schemaVersion: "1.0", packId, name: "字体", version: "1.0.0", publisher: "社内", minAppVersion: "0.5.0",
  contents: { fonts: [{ fontId: "mincho", file: "f/mincho.otf", displayName: "明朝" }] },
  files: [{ path: "f/mincho.otf", sha256: SHA }],
  licenses: [{ target: "fonts", license: "SIL OFL 1.1" }],
});

beforeEach(() => {
  fx.manifests = [];
  fx.userFonts = [{ id: "user_font_001", fileName: "a.ttf", displayName: "手書き" }];
  fx.loaded = [];
  setPackFontSources([]);
  useProjectStore.setState({ userFontIds: null, userFonts: [], userFontsUnreadable: false, packs: [] });
});

describe("パックの文字の形を一覧へ合流する", () => {
  it("持ち込みを読んだ後にパックを読むと、両方が一覧に並び、パックの字も読み込む", async () => {
    await useProjectStore.getState().refreshUserFonts();
    fx.manifests = [fontPack("office")];
    await useProjectStore.getState().loadPacks();
    const s = useProjectStore.getState();
    expect(s.userFontIds).toEqual(["user_font_001", "pack_office__mincho"]);
    expect(s.userFonts.map((f) => f.displayName)).toEqual(["手書き", "明朝"]);
    expect(fx.loaded).toContain("pack_office__mincho");
    expect(packFontIds()).toEqual(["pack_office__mincho"]);
  });

  it("パックを先に読んでも、持ち込みを読んだときに合流する（順番で欠けない）", async () => {
    fx.manifests = [fontPack("office")];
    await useProjectStore.getState().loadPacks();
    // ⚠️ 持ち込みをまだ調べていない＝「調べていない」のまま（パックの分だけで埋めない）
    expect(useProjectStore.getState().userFontIds).toBeNull();
    await useProjectStore.getState().refreshUserFonts();
    expect(useProjectStore.getState().userFontIds).toEqual(["user_font_001", "pack_office__mincho"]);
  });

  it("パックを外して読み直すと、そのパックの字は一覧から消える（持ち込みは残る）", async () => {
    await useProjectStore.getState().refreshUserFonts();
    fx.manifests = [fontPack("office")];
    await useProjectStore.getState().loadPacks();
    fx.manifests = [];
    await useProjectStore.getState().loadPacks();
    expect(useProjectStore.getState().userFontIds).toEqual(["user_font_001"]);
    expect(packFontIds()).toEqual([]);
  });

  it("持ち込みを読み直してもパックの字は残る", async () => {
    fx.manifests = [fontPack("office")];
    await useProjectStore.getState().loadPacks();
    await useProjectStore.getState().refreshUserFonts();
    fx.userFonts = [];
    await useProjectStore.getState().refreshUserFonts();
    expect(useProjectStore.getState().userFontIds).toEqual(["pack_office__mincho"]);
  });
});
