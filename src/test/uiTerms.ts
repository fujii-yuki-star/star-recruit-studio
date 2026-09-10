// 画面に出す言葉の門番が共有する道具（§2-3・`16 §1`／`06 §3` の置き換え表）。
//
// ⚠️ **写して増やさない**（#1111）＝同じ判定を「画面の直書き」（`screenTermScan.test.ts`）と
// 「Rust が返す文」（`rustUserMessageGuard.test.ts`）の両方が使う。片方にだけ語を足すと、
// **もう片方は素通り**する（このリポジトリで繰り返している「双子の片方だけ直す」型）。

/**
 * 画面に出さない語（§2-3・`16 §1` の置き換え表）。
 *
 * ⚠️ **`uiLabels.test.ts` の一覧とは別に持つ**＝あちらは文言の集約先を見る門番で、
 * こちらは**画面へ届く生の文字**を見る門番。射程が違うので、片方に足しても他方には効かない
 *（実際、「ナレーション」を `uiLabels.test.ts` へ足しても画面の直書きは素通りだった）。
 */
export const BANNED_IN_SCREENS = [
  "ナレーション",
  "レンダリング",
  "バリデーション",
  "スキーマ",
  // ⚠️ **素の「テンプレート」も入れる**（#984 レビュー ℹ️）＝`16 §1`／`06 §3` は
  // `template / テンプレート` を内部用語（表示は「見た目パターン」）としているのに、
  // `テンプレートID` しか入っておらず「テンプレートを選ぶ」のような直書きを拾えなかった。
  "テンプレート",
  "アセット",
  "プロバイダ",
  "キーフレーム",
  // ⚠️ **Rust 側で見つけた語**（#1111）＝画面へ返る `Err` の文に入っていた。
  // 「プロジェクトID」は §2-3 が名指しする ID そのもの、「サムネイル」の画面語は「小さな絵」
  //（`06 §12`）、「ポート」は接続の実装語。
  "プロジェクトID",
  "サムネイル",
  "ポート",
] as const;

/** 画面に出る文字とみなす＝**日本語を含む**文字列。 */
export const hasJapanese = (s: string): boolean => /[ぁ-んァ-ヶ一-龠]/.test(s);

/**
 * 本文から、**画面に出る日本語**を拾って禁止語を探す。
 *
 * ⚠️ **純粋関数として切り出す**＝ディレクトリを歩く形のままだと、
 * 「拾い方を消しても、いまのコードに漏れが無いので緑」になる（#981 で踏んだ）。
 */
export function bannedTermsIn(
  text: string,
  banned: readonly string[] = BANNED_IN_SCREENS,
): { word: string; text: string }[] {
  const out: { word: string; text: string }[] = [];
  // ⚠️ **コメントを外す**＝説明文には実装用語が出てよい（§2-3 が縛るのは表示だけ）。
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const seen = new Set<string>();
  const add = (raw: string): void => {
    const s = raw.trim();
    if (!s || !hasJapanese(s) || seen.has(s)) return;
    seen.add(s);
    for (const word of banned) if (s.includes(word)) out.push({ word, text: s });
  };
  // ① 文字列リテラル（属性・変数・関数の引数）。
  for (const m of code.matchAll(/(['"])((?:[^'"\\\r\n]|\\.)+)\1/g)) add(m[2]!);
  // ② JSX のテキスト（タグとタグの間）。`{...}` の式は中身を見ない（識別子が混じるだけ）。
  for (const m of code.matchAll(/>([^<>{}]+)</g)) add(m[1]!);
  return out;
}
