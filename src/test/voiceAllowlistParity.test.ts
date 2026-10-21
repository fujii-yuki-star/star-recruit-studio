// 会社の動画で使えるキャラの一覧が、画面（TS）と声を読ませる側（Rust）で同じか（2026-10-16・13 §4）。
//
// ⚠️ **2か所に同じ一覧がある**＝画面は入れる前に断る（`extensionPack.ts`）、Rust は声のファイルの中身の全キャラを見る
//   （`packs.rs` の `plan_voices`）。片方だけ直すと、画面では入るのに声が使えない（またはその逆）パックができる。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPANY_OK_VOICE_CHARACTERS } from "../domain/voice/voiceCatalog";

function rustList(): string[] {
  const src = readFileSync("src-tauri/src/packs.rs", "utf8");
  const m = /pub\(crate\) const COMPANY_OK_VOICE_CHARACTERS: &\[&str\] = &\[([\s\S]*?)\];/.exec(src);
  if (!m) throw new Error("packs.rs に COMPANY_OK_VOICE_CHARACTERS が見つからない");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("会社の動画で使えるキャラの一覧（TS と Rust）", () => {
  it("Rust の一覧を読める（読めないまま緑にしない）", () => {
    expect(rustList().length).toBeGreaterThan(10);
  });
  it("同じキャラが同じ数だけ並んでいる", () => {
    expect([...rustList()].sort()).toEqual([...COMPANY_OK_VOICE_CHARACTERS].sort());
  });
});
