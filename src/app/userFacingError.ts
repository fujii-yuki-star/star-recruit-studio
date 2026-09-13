// 「この断りは**画面に出してよい文**か」を見分ける関門（#1118 レビュー由来・#1123）。
//
// ⚠️ **両端で正反対のことをしていた**＝一方（`TroubleLogSection` / `ExportDoneActions`）は
// `.catch(() => …)` で**中身を全部捨て**、もう一方（`ExportScreen` / `HomeScreen` / `projectStore`）は
// `e.message` を**無条件で出して**いた。どちらも「**この文は画面に出してよいか**」を見ていない。
//
// ⚠️ **捨てる側の実害**＝原因を3つに書き分けても、画面では1つの定型文に潰れる
//（「覚えていない」も「もう無い」も「開くアプリが無い」も同じ文になる）。
// ⚠️ **出す側の実害**＝Rust には `map_err(|e| e.to_string())` が **62 か所**あり、
// `os error 3` のような**生の OS エラー**がそのまま画面へ出うる（`15 §6` は禁じている）。
//
// ⚠️ **物差しは Rust 側の門番と同じ**（`src/test/rustUserMessageGuard.test.ts`）＝
// **日本語を含み、句点を持つ**文だけを「画面に出すつもりで書かれた文」とみなす。
// 片方だけ物差しを変えると、通る／通らないが黙ってずれる。

/** Tauri のコマンドは**文字列で**失敗を返す（`Error` ではない）＝どちらの形でも受ける。 */
function textOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "";
}

/**
 * 画面に出してよい断りなら、その文。出してよくなければ `null`（呼び出し側の定型文を使う）。
 *
 * ⚠️ **通らなかった中身は捨てない**＝`console.error` へ流す。`troubleLogBridge` が
 * **うまくいかないときの記録**へ運ぶので、調べる材料は残る（画面に出さないだけ）。
 */
export function userFacingMessage(e: unknown, where: string): string | null {
  const text = textOf(e).trim();
  const ok = /[ぁ-んァ-ヶ一-龠]/.test(text) && text.includes("。");
  if (!ok) {
    // ⚠️ **記録にだけ残す**（§2-3＝画面には実装の言葉を出さない）。
    if (text !== "") console.error(`[${where}] 画面に出せない断り:`, text);
    return null;
  }
  return text;
}
