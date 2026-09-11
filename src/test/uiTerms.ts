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
  // ⚠️ **画面では「動画」と呼ぶ**（#1109 ⑤・利用者判断 2026-09-10）＝同じ場所を、左の帯は
  // 「プロジェクト」、タイムライン画面の右上は「動画の一覧へ」と**2つの言葉で呼んでいた**。
  // 利用者は人事・非エンジニアなので、作るものの名前で呼ぶ。**内部用語としては残す**（`projectId` ほか）。
  // ⚠️ **「プロジェクトID」は別に持たない**＝この1語が**部分一致で**そちらも拾う（自己検査で露見）。
  "プロジェクト",
  "サムネイル",
  // ⚠️ **部分一致であることに注意**（レビュー由来 ℹ️）＝`サポート` `エクスポート` `インポート`
  // `ビューポート` を含む文が入ると赤くなる。ADR-0034 決定21 は「動画編集の一般語は置き換えない」と
  // しているので、**踏んだらこの語を落とす**（誤検出は門番の信用を落とす）。いまは 0 件。
  "ポート",
  // ⚠️ **英字の識別子も入れる**（#1111 レビュー由来 🔴・2026-09-10）＝`CLAUDE.md §2-3` が
  // **名指しで**表示を禁じているのはこちらの綴り。片仮名の「テンプレートID」だけ入れていたので、
  // `Err("templateId がありません")` が**画面へ返っているのに素通り**していた（実際に踏んだ）。
  "templateId",
  "assetId",
  "projectId",
  "clipId",
  "sceneId",
  "JSON",
  "FFmpeg",
  "Provider",
] as const;

/**
 * 開発用の記録（`console.warn(…)` ほか）を**構造で**落とす。
 *
 * ⚠️ **一覧で外さない**（#1109 ⑤ レビュー由来・2026-09-10）＝走査を `src/app` 丸ごとへ広げたら、
 * `[timeline] 保存内容がスキーマに未適合:` のような**記録の文**で赤くなった。これは画面に出ない。
 * 「このファイルは対象外」と名前で外すと**次に足された記録が素通り**するので、**役目で外す**
 *（Rust 側で `tlog!` を外しているのと同じ流儀＝`src/test/rustUserMessageGuard.test.ts`）。
 * ⚠️ **括弧の釣り合いを数える**＝素朴に「次の `)` まで」だと、中の `format` 等で切れて続きを拾う。
 */
export function dropDevLogs(code: string): string {
  let out = "";
  let i = 0;
  const heads = ["console.warn(", "console.error(", "console.log(", "console.info(", "console.debug("];
  outer: while (i < code.length) {
    for (const h of heads) {
      if (code.startsWith(h, i)) {
        let depth = 0;
        let j = i + h.length - 1;
        for (; j < code.length; j += 1) {
          if (code[j] === "(") depth += 1;
          else if (code[j] === ")") {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        i = j + 1;
        continue outer;
      }
    }
    out += code[i];
    i += 1;
  }
  return out;
}

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
  const code = dropDevLogs(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
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
