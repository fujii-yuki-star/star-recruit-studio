// 画面から「開く」を頼む道が**1つだけ**であることの門番（#1118）。
//
// ⚠️ **実際に壊れていた**（2026-09-10 実機報告）＝設定の「記録の場所を開く」も、書き出し完了の
// 「動画を再生」も**必ず断られて**いた。opener プラグインの `open_path` は開く前に
// **許可の範囲（scope）**を見るのに、`capabilities/default.json` は権限を**許可しているだけで
// 範囲を1つも書いていなかった**＝`allowed.iter().any(...)` は空なら必ず false。
//
// ⚠️ **範囲を書き足す道は採らなかった**＝書き出した動画は**利用者が保存先を選ぶ**ので範囲で表せない。
// Rust 側に入口を1つ作り（`open_produced_path`）、**アプリが自分で作った場所**だけを開く。
//
// ⚠️ **だから「権限を戻す」ことを禁じる**＝戻すと、画面から**任意の場所**を指せる道が復活する
//（`open_path` は**プログラムを起動しうる**）。しかも範囲を書き忘れれば、また**黙って全部弾かれる**。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string): string => readFileSync(join(process.cwd(), p), "utf8");

/** 画面から直に `open_path` を呼んでいる所（プラグインの取り込みを見る）。 */
export function pluginOpenPathUses(src: string): string[] {
  return src
    .split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    // ⚠️ **注記は数えない**＝この門番の理由を書いた行で赤くしない。
    .filter(({ line }) => !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*"))
    .filter(({ line }) => /\bopenPath\b/.test(line))
    .map(({ line, n }) => `${n}: ${line}`);
}

describe("画面から「開く」を頼む道は1つだけ（#1118）", () => {
  it("`opener:allow-open-path` を capabilities に戻していない", () => {
    const caps = read("src-tauri/capabilities/default.json");
    expect(caps).not.toContain("allow-open-path");
    // ⚠️ **場所を見せる方は残す**＝`reveal_item_in_dir` には範囲の検査が無く、
    // 「保存した場所を開く」はこれで動いている（壊していないことを留める）。
    expect(caps).toContain("opener:allow-reveal-item-in-dir");
  });

  it("画面はプラグインの `openPath` を呼ばない（Rust の入口を通す）", () => {
    const src = read("src/infrastructure/opener.ts");
    expect(pluginOpenPathUses(src), "`open_produced_path` を通してください").toEqual([]);
    expect(src, "Rust の入口を呼んでいない").toContain("open_produced_path");
  });

  it("Rust の入口が、覚えている場所だけを開く", () => {
    const rs = read("src-tauri/src/opener.rs");
    // ⚠️ **関門があること**＝覚えていない場所は断る。
    expect(rs).toContain("if !is_produced(");
    // ⚠️ **覚える側が2つとも繋がっていること**＝記録の置き場と、書き出した動画。
    expect(read("src-tauri/src/trouble_log.rs"), "記録の置き場を覚えていない").toContain("opener::remember");
    expect(read("src-tauri/src/ffmpeg.rs"), "書き出した動画を覚えていない").toContain("opener::remember");
  });
});

describe("門番自身の検査（わざと壊した入力）", () => {
  it("`openPath` の直呼びを見つける", () => {
    expect(pluginOpenPathUses('await openPath(path);')).toHaveLength(1);
  });

  it("注記の中の `openPath` では赤くしない（誤検出は門番の信用を落とす）", () => {
    expect(pluginOpenPathUses("// openPath を直に呼ばない")).toEqual([]);
    expect(pluginOpenPathUses(" * `openPath` は範囲を見る")).toEqual([]);
  });

  it("似た名前を巻き込まない（語の切れ目で見る）", () => {
    // ⚠️ **別の識別子は拾わない**＝`openPathLabel` のような名前で赤くすると、門番の信用が落ちる。
    expect(pluginOpenPathUses("const openPathLabel = 1;")).toEqual([]);
    expect(pluginOpenPathUses("await openUrl(u);")).toEqual([]);
    // ⚠️ **呼び出しは拾う**（取り込み直後の形も）。
    expect(pluginOpenPathUses('import { openPath } from "@tauri-apps/plugin-opener";')).toHaveLength(1);
  });
});
