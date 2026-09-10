// Rust が**画面へ返す文**の門番（#1111・§2-3／§2-5）。
//
// ⚠️ **門番の向きが片方だけだった**＝`src/app/errorStateTable.test.ts` は
// 「**表にある行**が実装のどこかに在るか」を見る。だから**実装にしか無い文**は、
// 正典に1行も無くても、次の行動を言っていなくても、誰にも見られなかった。
// 実際、`ffmpeg.rs` の利用者向けの文 29 種のうち `15_ERROR_STATE_MODEL.md` に載っていたのは **0 件**。
//
// ⚠️ **`15` に全部載せるのではなく、質を機械で守る**（利用者判断 2026-09-10＝#1111 の B＋C）＝
// 断りの**中身**（`EXPORT_FAILED` の `detail`）は表の対象外と `15 §6` に明記したうえで、
// **文言の質**（次の行動を示す・実装用語を出さない）はここで見る。
//
// ⚠️ **完璧な判別はできない**＝「画面へ届くか」を静的に追い切ることはできないので、
// **日本語で書かれ、句点で終わる文字列**を「画面へ出すつもりで書かれた文」とみなす。
// 記録（`tlog!`）と開発用の出力（`eprintln!`）と検査（`#[cfg(test)]`）は**構造で外す**
//（一覧に書いて外すと、次に足された分が黙って素通りする）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bannedTermsIn } from "./uiTerms";

/** Rust の置き場（再帰＝サブフォルダも見る）。 */
function rustFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return rustFiles(p);
    return name.endsWith(".rs") ? [p] : [];
  });
}

/** `name!(` の呼び出しを、括弧の釣り合いを数えて丸ごと落とす。 */
function dropMacroCalls(src: string, name: string): string {
  let out = "";
  let i = 0;
  const head = `${name}!(`;
  for (;;) {
    const at = src.indexOf(head, i);
    if (at < 0) return out + src.slice(i);
    out += src.slice(i, at);
    let depth = 0;
    let j = at + head.length - 1;
    for (; j < src.length; j += 1) {
      if (src[j] === "(") depth += 1;
      else if (src[j] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    i = j + 1;
  }
}

/**
 * **画面へ返すつもりで書かれた文**だけを残す（記録・開発用の出力・検査を落とす）。
 *
 * ⚠️ **一覧で外さない**＝「これは記録だから対象外」と名前で書いて外すと、
 * **次に足された記録**が対象に入ってしまい、意味の無い赤で門番の信用が落ちる。
 * `tlog!` は**定義からして記録**（画面には出さない＝`trouble_log.rs` の冒頭）なので、構造で外せる。
 */
export function stripNonUserText(src: string): string {
  // 注記（ブロック・行）。⚠️ 行の注記は `///` も含む（説明文に実装用語が出てよい）。
  let s = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  // ⚠️ **`crate::tlog` を別に書かない**＝`tlog!(` は `crate::tlog!(` の中にも当たる（変異チェックで露見）。
  s = dropMacroCalls(s, "tlog");
  s = dropMacroCalls(s, "eprintln");
  s = dropMacroCalls(s, "println");
  // 検査（`#[cfg(test)] mod tests { … }`）＝ファイルの末尾まで落とす。
  const at = s.indexOf("#[cfg(test)]");
  return at < 0 ? s : s.slice(0, at);
}

/**
 * 画面へ返すつもりで書かれた文（**日本語を含み、句点を持つ**文字列リテラル）。
 *
 * ⚠️ **句点で絞る**＝日本語の識別子まがいの短い語（札の名前など）を拾わない。
 * 断りは必ず文の形（`15 §6`＝「次の行動を示す」）なので、句点は必ず入る。
 */
export function userMessagesIn(src: string): string[] {
  const body = stripNonUserText(src);
  const out = new Set<string>();
  for (const m of body.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const lit = m[1] ?? "";
    if (!/[ぁ-んァ-ヶ一-龠]/.test(lit)) continue;
    if (!lit.includes("。")) continue;
    out.add(lit);
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
 * **次の行動を書かなくてよい文**（理由つきで明示的に外す）。
 *
 * ⚠️ **黙って外さない**＝ここが空でないなら、なぜ次の行動が要らないのかを1行で書く。
 */
const NO_ACTION_OK: Record<string, string> = {
  // ⚠️ **いまは空**＝29 件すべてに次の行動がある状態にした（#1111）。
};

/**
 * 1つの Rust ソースから、**画面へ返す文に混じった実装用語**を拾う（§2-3）。
 *
 * ⚠️ **画面の直書きと同じ物差しを使う**（`src/test/uiTerms.ts`）＝語を片方にだけ足して、
 * もう片方が素通りする形にしない。
 * ⚠️ **1つの関数にまとめる**＝下の「門番自身の検査」が**この道**を通るようにするため。
 * 走る所と自己検査が別の道だと、走る所だけ物差しを狭めても誰も気づかない（変異チェックで露見）。
 */
export function termHitsIn(src: string): { word: string; text: string }[] {
  return bannedTermsIn(stripNonUserText(src));
}

const files = (): string[] => rustFiles(join(process.cwd(), "src-tauri/src"));

describe("Rust が画面へ返す文（#1111）", () => {
  it("走査が空振りしていない（文を拾えている）", () => {
    // ⚠️ **拾えていないのに緑**を作らない＝拾い方が壊れたら、下の2つは無条件で通る。
    const all = files().flatMap((p) => userMessagesIn(readFileSync(p, "utf8")));
    expect(all.length, "Rust から利用者向けの文を1つも拾えていない＝走査が壊れている").toBeGreaterThanOrEqual(29);
  });

  it("どの文も、次の行動を示している（§2-5）", () => {
    const bad = files().flatMap((p) =>
      userMessagesIn(readFileSync(p, "utf8"))
        .filter((m) => !showsNextAction(m) && !NO_ACTION_OK[m])
        .map((m) => `${p.replace(/\\/g, "/").split("src-tauri/")[1]}: ${m}`),
    );
    expect(bad, "断りは「原因」でなく「次の行動」を示してください（§2-5・`15 §6`）").toEqual([]);
  });

  it("どの文にも、実装用語が混じっていない（§2-3）", () => {
    const bad = files().flatMap((p) =>
      termHitsIn(readFileSync(p, "utf8")).map(
        (h) => `${p.replace(/\\/g, "/").split("src-tauri/")[1]}: 「${h.word}」← ${h.text}`,
      ),
    );
    expect(bad, "画面に出す言葉を `16 §1`／`06 §3` の置き換え表に合わせてください").toEqual([]);
  });
});

describe("門番自身の検査（わざと壊した入力）", () => {
  it("記録（`tlog!`）は画面の文と数えない", () => {
    const src = 'crate::tlog!("voicevox", "空きポートの確保に失敗。見送ります。");';
    expect(userMessagesIn(src)).toEqual([]);
  });

  it("記録を落としても、その外側の文は残る", () => {
    const src = 'crate::tlog!("t", "記録の文。");\nreturn Err("画面の文。もう一度お試しください。".to_string());';
    expect(userMessagesIn(src)).toEqual(["画面の文。もう一度お試しください。"]);
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

  it("実装用語を拾う（画面の直書きと同じ一覧を使っている）", () => {
    // ⚠️ **走る所と同じ道を通る**＝物差しを狭めたり、一覧から語を落としたら、ここが赤くなる。
    const hits = termHitsIn('return Err("不正なプロジェクトIDです。".to_string());');
    expect(hits.map((h) => h.word)).toEqual(["プロジェクトID"]);
    expect(termHitsIn('return Err("この動画を開けませんでした。動画の一覧から開き直してください。".to_string());')).toEqual([]);
  });

  it("次の行動の有無を見分ける", () => {
    expect(showsNextAction("動画のサムネイル作成に失敗しました。")).toBe(false);
    expect(showsNextAction("すでに書き出し中です。完了までお待ちください。")).toBe(true);
    expect(showsNextAction("保存先を選び直してください。")).toBe(true);
  });

  it("括弧の釣り合いを数える（記録の中の括弧で切り上げない）", () => {
    // ⚠️ 素朴に「次の `)` まで」で落とすと、`format!(...)` の途中で切れて**続きの文を拾ってしまう**。
    const src = 'crate::tlog!("t", "{}", format!("中の文。"));\nlet z = "外の文。押してください。";';
    expect(userMessagesIn(src)).toEqual(["外の文。押してください。"]);
  });
});
