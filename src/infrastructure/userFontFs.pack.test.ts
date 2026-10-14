// 拡張パックの文字の形の読み込み（ADR-0060 段階2）＝パックの中から読み、外したら登録を外す。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ reads: [] as string[], userReads: [] as string[] }));
vi.mock("./packFs", () => ({
  readPackDataUrl: vi.fn(async (packId: string, rel: string) => {
    fx.reads.push(`${packId}/${rel}`);
    return "data:font/otf;base64,QUJD";
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: { fontId: string }) => {
    fx.userReads.push(`${cmd}:${args.fontId}`);
    return "QUJD";
  }),
}));

import { ensureUserFontLoaded, packFontIds, resetRegisteredUserFonts, setPackFontSources } from "./userFontFs";

class FakeFace {
  constructor(public family: string, public bytes: Uint8Array, public desc: { weight: string }) {}
  async load(): Promise<void> {}
}
const added: FakeFace[] = [];

beforeEach(() => {
  fx.reads = [];
  fx.userReads = [];
  added.length = 0;
  resetRegisteredUserFonts();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  vi.stubGlobal("FontFace", FakeFace);
  vi.stubGlobal("document", {
    fonts: {
      add: (f: FakeFace) => { added.push(f); },
      delete: (f: FakeFace) => { added.splice(added.indexOf(f), 1); },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("パックの文字の形の読み込み", () => {
  it("パックの中のファイルから読み、家族名＝id で太さ2つを登録する（持ち込みの置き場は読まない）", async () => {
    setPackFontSources([{ id: "pack_office__mincho", packId: "office", file: "f/mincho.otf", sha256: "a" }]);
    expect(await ensureUserFontLoaded("pack_office__mincho")).toBe(true);
    expect(fx.reads).toEqual(["office/f/mincho.otf"]);
    expect(fx.userReads).toEqual([]);
    expect(added.map((f) => [f.family, f.desc.weight, [...f.bytes]])).toEqual([
      ["pack_office__mincho", "400", [65, 66, 67]],
      ["pack_office__mincho", "700", [65, 66, 67]],
    ]);
  });

  it("入っていないパックの字は読めない（描画は既定へ倒れる）", async () => {
    expect(await ensureUserFontLoaded("pack_office__mincho")).toBe(false);
    expect(fx.reads).toEqual([]);
  });

  it("外すと登録を外し、入れ直すと読み直す（外したパックの字で描き続けない）", async () => {
    setPackFontSources([{ id: "pack_office__mincho", packId: "office", file: "f/mincho.otf", sha256: "a" }]);
    await ensureUserFontLoaded("pack_office__mincho");
    setPackFontSources([]);
    expect(added).toEqual([]);
    expect(packFontIds()).toEqual([]);
    setPackFontSources([{ id: "pack_office__mincho", packId: "office", file: "f/mincho2.otf", sha256: "a" }]);
    await ensureUserFontLoaded("pack_office__mincho");
    expect(fx.reads).toEqual(["office/f/mincho.otf", "office/f/mincho2.otf"]);
  });

  it("置き場が変わらなければ登録はそのまま（読み直さない）", async () => {
    const src = [{ id: "pack_office__mincho", packId: "office", file: "f/mincho.otf", sha256: "a" }];
    setPackFontSources(src);
    await ensureUserFontLoaded("pack_office__mincho");
    setPackFontSources(src);
    await ensureUserFontLoaded("pack_office__mincho");
    expect(fx.reads).toEqual(["office/f/mincho.otf"]);
    expect(added).toHaveLength(2);
  });

  it("新しい版でファイル名が同じでも、中身が違えば読み直す", async () => {
    setPackFontSources([{ id: "pack_office__mincho", packId: "office", file: "f/mincho.otf", sha256: "a" }]);
    await ensureUserFontLoaded("pack_office__mincho");
    setPackFontSources([{ id: "pack_office__mincho", packId: "office", file: "f/mincho.otf", sha256: "b" }]);
    await ensureUserFontLoaded("pack_office__mincho");
    expect(fx.reads).toEqual(["office/f/mincho.otf", "office/f/mincho.otf"]);
    expect(added).toHaveLength(2);
  });

  it("読んでいる途中にパックを外したら登録しない（外した字が残らない・入れ直すと読み直す）", async () => {
    setPackFontSources([{ id: "pack_office__mincho", packId: "office", file: "f/mincho.otf", sha256: "a" }]);
    const p = ensureUserFontLoaded("pack_office__mincho");
    setPackFontSources([]);
    expect(await p).toBe(false);
    expect(added).toEqual([]);
    setPackFontSources([{ id: "pack_office__mincho", packId: "office", file: "f/mincho.otf", sha256: "a" }]);
    expect(await ensureUserFontLoaded("pack_office__mincho")).toBe(true);
    expect(added).toHaveLength(2);
  });

  it("持ち込みの字は今までどおり持ち込みの置き場から読む", async () => {
    expect(await ensureUserFontLoaded("user_font_001")).toBe(true);
    expect(fx.userReads).toEqual(["read_user_font:user_font_001"]);
  });
});
