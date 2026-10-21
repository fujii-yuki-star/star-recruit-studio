// 書き出し前の文字の読み込み＝持ち込みと拡張パックの文字の形を同じ入口で読む（ADR-0038・ADR-0060 段階2）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ loaded: [] as string[] }));
vi.mock("../../infrastructure/userFontFs", () => ({
  listUserFonts: vi.fn(async () => [{ id: "user_font_001", fileName: "a.ttf", displayName: "A" }]),
  loadUserFonts: vi.fn(async (ids: readonly string[]) => { fx.loaded.push(...ids); }),
  packFontIds: vi.fn(() => ["pack_office__mincho"]),
}));

import { loadExportFonts } from "./loadExportFonts";

beforeEach(() => {
  fx.loaded = [];
  vi.stubGlobal("document", { fonts: { load: vi.fn(async () => []) } });
});
afterEach(() => vi.unstubAllGlobals());

describe("loadExportFonts", () => {
  it("持ち込みと拡張パックの文字の形をどちらも読み込む（ここを通らない字体は焼けない）", async () => {
    await loadExportFonts();
    expect(fx.loaded).toEqual(["user_font_001", "pack_office__mincho"]);
  });
});
