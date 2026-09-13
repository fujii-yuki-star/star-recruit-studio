// 「この断りは**画面に出してよい文**か」を見分ける関門（#1118 レビュー由来・#1123）。
//
// ⚠️ **両端で正反対のことをしていた**＝一方（`TroubleLogSection` / `ExportDoneActions`）は
// `.catch(() => …)` で**中身を全部捨て**、もう一方（`ExportScreen` / `HomeScreen` / `projectStore`）は
// `e.message` を**無条件で出して**いた。どちらも「**この文は画面に出してよいか**」を見ていない。
//
// ⚠️ **捨てる側の実害**＝原因を3つに書き分けても、画面では1つの定型文に潰れる
//（「覚えていない」も「もう無い」も「開くアプリが無い」も同じ文になる）。
// ⚠️ **出す側の実害**＝Rust には `map_err(|e| e.to_string())` が **56 か所**あり、
// `os error 3` のような**生の OS エラー**がそのまま画面へ出うる（`15 §6` は禁じている）。
// （数は `15_ERROR_STATE_MODEL.md §6` の「この門番が見ていないもの」と同じ数え方＝
//  `grep -c "map_err(|e| e.to_string())"`。以前ここだけ 62 と書いていた＝写し間違い。）
//
// ⚠️ **物差しは1か所**（レビュー由来 🟡）＝以前はこの版・`rustUserMessageGuard.test.ts`・
// `uiTerms.ts` の**3か所に同じ正規表現が並んで**いて、「Rust 側の門番と同じ」と書いた主張が
// **写しでしか保たれていなかった**（片方を狭めても、もう片方は黙って通し続ける）。
// いまは `hasJapanese` / `isUserFacingSentence` をここから配り、門番側が取り込む
//（`src/test/oneJapaneseMatcherGuard.test.ts` が「定義が1つだけ」を見ている）。
//
// ⚠️ **この関門が保証しないこと**（レビュー由来 ℹ️・正直に書く）＝
// **日本語の文の中に生の詳細を埋めた形**（`lib.rs` の「…お試しください。（{e}）」）は**通る**。
// ここが断てるのは「文になっていないもの」までで、§2-3 を丸ごと保証するものではない。
// 埋め込む側を断つのは Rust 側の門番（`rustUserMessageGuard`）の仕事。

/** Tauri のコマンドは**文字列で**失敗を返す（`Error` ではない）＝どちらの形でも受ける。 */
function textOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "";
}

/**
 * **画面に出る文字**とみなす＝日本語を含む（`06 §3` の置き換え語も、断りの文も日本語で書く）。
 *
 * ⚠️ **ここが唯一の定義**＝門番（`rustUserMessageGuard` / `uiTerms`）もこれを取り込む。
 */
export const hasJapanese = (s: string): boolean => /[ぁ-んァ-ヶ一-龠]/.test(s);

/**
 * **画面に出すつもりで書かれた文**か＝日本語を含み、**句点で終わる文になっている**。
 *
 * ⚠️ **両方を見る**＝句点だけなら記号の羅列（`ERROR: open failed。`）が通り、
 * 日本語だけなら `format!` で割られた断片（「不正なプロジェクトIDです」）が通る。
 */
export const isUserFacingSentence = (s: string): boolean => hasJapanese(s) && s.includes("。");

/**
 * 画面に出してよい断りなら、その文。出してよくなければ `null`（呼び出し側の定型文を使う）。
 *
 * ⚠️ **通らなかった中身は捨てない**＝`console.error` へ流す。`troubleLogBridge` が
 * **うまくいかないときの記録**へ運ぶので、調べる材料は残る（画面に出さないだけ）。
 */
export function userFacingMessage(e: unknown, where: string): string | null {
  const text = textOf(e).trim();
  const ok = isUserFacingSentence(text);
  if (!ok) {
    // ⚠️ **記録にだけ残す**（§2-3＝画面には実装の言葉を出さない）。
    if (text !== "") console.error(`[${where}] 画面に出せない断り:`, text);
    return null;
  }
  return text;
}
