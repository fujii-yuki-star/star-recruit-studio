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

  it("Rust の入口が、関門を通る（分岐そのものは Rust の検査が見る）", () => {
    const rs = read("src-tauri/src/opener.rs");
    // ⚠️ **字面だけでは足りない**（レビュー由来 🔴）＝以前は `if !is_produced(` を含むかだけを見ており、
    // **中身の `return Err` を消す**変異が捕まらなかった（判定は残るが関門は効かない）。
    // いまは関門を**純粋関数**（`guard_produced`）に切り出し、**分岐そのもの**を Rust の検査が叩く
    //（`opener.rs` の `関門は覚えていない場所を断る` ほか3件）。ここは**通していること**だけを見る。
    expect(rs).toContain("guard_produced(&p)");
    expect(rs).toContain("pub fn guard_produced(");
  });

  it("「覚える側」と「開く側」の数が合っている", () => {
    // ⚠️ **決め打ちの2ファイルでは足りない**（レビュー由来 🟡）＝将来3つ目の「開く」導線を足したとき、
    // `remember` を忘れても**この門番は気づかなかった**（#1118 と**同じ壊れ方**が再発する）。
    // **数で留める**＝増やしたらここも見直すことになる。
    const callers = [read("src/app/components/ExportDoneActions.tsx"), read("src/app/components/TroubleLogSection.tsx")]
      .join("\n")
      .split("openSavedFile(").length - 1;
    expect(callers, "「開く」導線の数が変わった＝覚える側も足したか確かめて、この数を直す").toBe(2);

    const remembers = ["src-tauri/src/trouble_log.rs", "src-tauri/src/ffmpeg.rs"]
      .map((f) => read(f).split("opener::remember(").length - 1)
      .reduce((a, b) => a + b, 0);
    expect(remembers, "覚える側の数が変わった＝開く導線と対応しているか確かめて、この数を直す").toBe(2);
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
