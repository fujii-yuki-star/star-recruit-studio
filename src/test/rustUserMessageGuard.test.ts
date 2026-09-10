// Rust が**画面へ返す文**の門番（#1111・§2-3／§2-5）。
//
// ⚠️ **門番の向きが片方だけだった**＝`src/app/errorStateTable.test.ts` は
// 「**表にある行**が実装のどこかに在るか」を見る。だから**実装にしか無い文**は、
// 正典に1行も無くても、次の行動を言っていなくても、誰にも見られなかった。
// 実際、`ffmpeg.rs` の利用者向けの文 29 種のうち `15_ERROR_STATE_MODEL.md` に載っていたのは **0 件**。
//
// ⚠️ **`15` に全部載せるのではなく、質を機械で守る**（利用者判断 2026-09-10＝#1111 の B＋C）＝
// 断りの**中身**（`EXPORT_FAILED` の `detail`）は表の対象外と `15 §6.0` に明記したうえで、
// **文言の質**（次の行動を示す・実装用語を出さない）はここで見る。
//
// ⚠️ **完璧な判別はできない**＝「画面へ届くか」を静的に追い切ることはできないので、
// **日本語で書かれ、句点を持つ文字列**を「画面へ出すつもりで書かれた文」とみなす。
// 記録（`tlog!`）と開発用の出力（`eprintln!`）と検査（`#[cfg(test)]`）は**構造で外す**
//（一覧に書いて外すと、次に足された分が黙って素通りする）。
//
// ⚠️ **拾い方は共有する**（`src/test/rustSource.ts`）＝最初は自分で `"` を対にして数えていたが、
// `ffmpeg.rs:2254` の**文字リテラル `'"'`** でそこから対応が反転し、**その行より後ろの文字列を
// 1つも拾えていなかった**（7000 行のうち半分以上が門番の外にいた）。
// 同じ罠は `noWindowSpawnGuard` が先に解いていたので、**1か所へ寄せた**。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bannedTermsIn } from "./uiTerms";
import { macroCallRanges, scanRust } from "./rustSource";

/** Rust の置き場（再帰＝サブフォルダも見る）。 */
function rustFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return rustFiles(p);
    return name.endsWith(".rs") ? [p] : [];
  });
}

/** 画面に出さない所（記録・開発用の出力・検査）。**名前で外すのではなく、役目で外す**。 */
const NOT_ON_SCREEN = ["tlog", "eprintln", "println"] as const;

/**
 * 画面へ返すつもりで書かれた文（**日本語を含み、句点を持つ**文字列リテラル）。
 *
 * ⚠️ **句点で絞る**＝日本語の識別子まがいの短い語（札の名前など）を拾わない。
 * 断りは必ず文の形（`15 §6`＝「次の行動を示す」）なので、句点は必ず入る。
 * ⚠️ **検査（`#[cfg(test)]`）から後ろは見ない**＝fixture の文は画面に出ない。
 * ⚠️ **記録（`tlog!`）の中は見ない**＝`trouble_log.rs` の冒頭が「画面には出さない」と定義している。
 */
export function userMessagesIn(src: string): string[] {
  const { code, literals } = scanRust(src);
  // 検査は**ファイルの末尾まで**落とす（`#[cfg(test)] mod tests { … }`）。
  const testAt = code.indexOf("#[cfg(test)]");
  const limit = testAt < 0 ? code.length : testAt;
  const skip = macroCallRanges(code, NOT_ON_SCREEN);
  const inSkip = (at: number): boolean => skip.some(([from, to]) => at >= from && at <= to);
  const out = new Set<string>();
  for (const { text, at } of literals) {
    if (at >= limit || inSkip(at)) continue;
    if (!/[ぁ-んァ-ヶ一-龠]/.test(text)) continue;
    if (!text.includes("。")) continue;
    out.add(text);
  }
  return [...out].sort();
}

/**
 * その文が**次の行動**を示しているか（§2-5）。
 *
 * ⚠️ **「〜してください」以外の形もある**＝「完了までお待ちください」は待つことが次の行動。
 * 逆に「〜に失敗しました。」で終わる文は、**何をすればよいか誰にも分からない**。
 */
export function showsNextAction(message: string): boolean {
  return /ください/.test(message);
}

/**
 * 1つの Rust ソースから、**画面へ返す文に混じった実装用語**を拾う（§2-3）。
 *
 * ⚠️ **画面の直書きと同じ物差しを使う**（`src/test/uiTerms.ts`）＝語を片方にだけ足して、
 * もう片方が素通りする形にしない。
 * ⚠️ **1つの関数にまとめる**＝下の「門番自身の検査」が**この道**を通るようにするため。
 * 走る所と自己検査が別の道だと、走る所だけ物差しを狭めても誰も気づかない（変異チェックで露見）。
 */
export function termHitsIn(src: string): { word: string; text: string }[] {
  return userMessagesIn(src).flatMap((m) => bannedTermsIn(`"${m}"`));
}

/**
 * **次の行動を書かなくてよい文**（理由つきで明示的に外す）。
 *
 * ⚠️ **黙って外さない**＝ここが空でないなら、なぜ次の行動が要らないのかを1行で書く。
 */
const NO_ACTION_OK: Record<string, string> = {
  // ⚠️ **いまは空**＝画面へ返る文すべてに次の行動がある状態にした（#1111）。
};

const files = (): string[] => rustFiles(join(process.cwd(), "src-tauri/src"));
const where = (p: string): string => p.replace(/\\/g, "/").split("src-tauri/")[1] ?? p;

describe("Rust が画面へ返す文（#1111）", () => {
  it("走査が空振りしていない（文を拾えている）", () => {
    // ⚠️ **拾えていないのに緑**を作らない＝拾い方が壊れたら、下の2つは無条件で通る。
    // ⚠️ **実数で留める**＝最初は「29 以上」にしていたが、文字リテラルで走査が反転して
    // **半分しか拾えていない状態でも通って**いた（実際に踏んだ）。数を固定すると、その場で気づく。
    const all = files().flatMap((p) => userMessagesIn(readFileSync(p, "utf8")));
    expect(new Set(all).size, "拾えた文の数が変わった（増減したら数も直す）").toBe(90);
  });

  it("どの文も、次の行動を示している（§2-5）", () => {
    const bad = files().flatMap((p) =>
      userMessagesIn(readFileSync(p, "utf8"))
        .filter((m) => !showsNextAction(m) && !NO_ACTION_OK[m])
        .map((m) => `${where(p)}: ${m}`),
    );
    expect(bad, "断りは「原因」でなく「次の行動」を示してください（§2-5・`15 §6`）").toEqual([]);
  });

  it("どの文にも、実装用語が混じっていない（§2-3）", () => {
    const bad = files().flatMap((p) =>
      termHitsIn(readFileSync(p, "utf8")).map((h) => `${where(p)}: 「${h.word}」← ${h.text}`),
    );
    expect(bad, "画面に出す言葉を `16 §1`／`06 §3` の置き換え表に合わせてください").toEqual([]);
  });
});

describe("門番自身の検査（わざと壊した入力）", () => {
  it("**文字リテラルで対応が反転しない**（実際に踏んだ・#1111）", () => {
    // ⚠️ `ffmpeg.rs:2254` に `'"'`（保存名に使えない文字の判定）が実在する。
    // 素朴に `"` を対にして数えると、**ここから後ろの文字列を1つも拾えなくなる**。
    const src = "if matches!(c, '/' | '\\\\' | '\"' | '<') { }\nlet m = \"この先の文。押してください。\";";
    expect(userMessagesIn(src)).toEqual(["この先の文。押してください。"]);
  });

  it("記録（`tlog!`）は画面の文と数えない", () => {
    expect(userMessagesIn('crate::tlog!("voicevox", "空きポートの確保に失敗。見送ります。");')).toEqual([]);
  });

  it("記録を落としても、その外側の文は残る", () => {
    const src = 'crate::tlog!("t", "記録の文。");\nreturn Err("画面の文。もう一度お試しください。".to_string());';
    expect(userMessagesIn(src)).toEqual(["画面の文。もう一度お試しください。"]);
  });

  it("括弧の釣り合いを数える（記録の中の括弧で切り上げない）", () => {
    // ⚠️ 素朴に「次の `)` まで」で落とすと、`format!(...)` の途中で切れて**続きの文を拾ってしまう**。
    const src = 'crate::tlog!("t", "{}", format!("中の文。"));\nlet z = "外の文。押してください。";';
    expect(userMessagesIn(src)).toEqual(["外の文。押してください。"]);
  });

  it("注記の中の文は拾わない（説明文に実装用語が出てよい）", () => {
    expect(userMessagesIn('/// 「テンプレートID が不正です。」を返す\nlet x = 1;')).toEqual([]);
    expect(userMessagesIn('/* "レンダリングに失敗しました。" */\nlet y = 2;')).toEqual([]);
  });

  it("検査の中の文は拾わない（fixture は画面に出ない）", () => {
    const src = 'let a = 1;\n#[cfg(test)]\nmod tests {\n  const M: &str = "検査用の文。";\n}';
    expect(userMessagesIn(src)).toEqual([]);
  });

  it("句点の無い日本語は拾わない（札の名前など）", () => {
    expect(userMessagesIn('crate::record("音声合成", x);')).toEqual([]);
  });

  it("日本語を含まない文字列は拾わない（実装の値に句点が混じっても文と数えない）", () => {
    expect(userMessagesIn('let s = "ABC。";')).toEqual([]);
  });

  it("次の行動の有無を見分ける", () => {
    expect(showsNextAction("動画のサムネイル作成に失敗しました。")).toBe(false);
    expect(showsNextAction("すでに書き出し中です。完了までお待ちください。")).toBe(true);
    expect(showsNextAction("保存先を選び直してください。")).toBe(true);
  });

  it("実装用語を拾う（画面の直書きと同じ一覧を使っている）", () => {
    // ⚠️ **走る所と同じ道を通る**＝物差しを狭めたり、一覧から語を落としたら、ここが赤くなる。
    const hits = termHitsIn('return Err("不正なプロジェクトIDです。".to_string());');
    expect(hits.map((h) => h.word)).toEqual(["プロジェクトID"]);
    expect(termHitsIn('return Err("この動画を開けませんでした。動画の一覧から開き直してください。".to_string());')).toEqual([]);
  });
});
