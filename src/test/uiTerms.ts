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
  // ⚠️ **画面では「動画」と呼ぶ**（#1026・利用者判断 2026-09-10）＝同じ場所を、左の帯は
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
 * 開発用の記録（`console.warn(…)` ほか）が**どこからどこまでか**を返す（`[from, to)` の一覧）。
 *
 * ⚠️ **一覧で外さない**（#1026 レビュー由来・2026-09-10）＝走査を `src/app` 丸ごとへ広げたら、
 * `[timeline] 保存内容がスキーマに未適合:` のような**記録の文**で赤くなった。これは画面に出ない。
 * 「このファイルは対象外」と名前で外すと**次に足された記録が素通り**するので、**役目で外す**
 *（Rust 側で `tlog!` を外しているのと同じ流儀＝`src/test/rustUserMessageGuard.test.ts`）。
 * ⚠️ **括弧の釣り合いを数える**＝素朴に「次の `)` まで」だと、中の `format` 等で切れて続きを拾う。
 * ⚠️ **渡すのは `scanTs` の `code`**（#1142）＝文字列の中身が空白になっているので、
 * **文の中の `(` `)` で釣り合いが狂わない**（以前は生の本文を数えていたので、
 * `console.warn("（）")` のような文で数がずれる形が残っていた）。座標は元のソースと同じ。
 */
export function devLogRanges(code: string): [number, number][] {
  const out: [number, number][] = [];
  const heads = ["console.warn(", "console.error(", "console.log(", "console.info(", "console.debug("];
  let i = 0;
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
        out.push([i, Math.min(j + 1, code.length)]);
        i = j + 1;
        continue outer;
      }
    }
    i += 1;
  }
  return out;
}
/**
 * 画面に出る文字とみなす＝**日本語を含む**文字列。
 *
 * ⚠️ **定義は `src/app/userFacingError.ts` に1つ**（レビュー由来 🟡）＝以前はここと
 * `rustUserMessageGuard.test.ts` と関門の**3か所に同じ正規表現が並んで**いた。
 * ここは名前を配り直すだけ（使う側の取り込み先を変えずに済ませる）。
 * ⚠️ **`export ... from` だけでは足りない**＝この file の中でも使っているので、
 * **取り込んでから配り直す**（再輸出だけだと局所の名前が未定義になる＝実際に3件赤くなった）。
 */
import { hasJapanese } from "../app/userFacingError";
import { scanTs } from "./tsSource";
export { hasJapanese };

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
  for (const s of screenTextsIn(text)) {
    for (const word of banned) if (s.includes(word)) out.push({ word, text: s });
  }
  return out;
}

/**
 * 本文から、**画面に出る日本語**だけを拾う（重複は畳む）。
 *
 * ⚠️ **拾い方を1か所に持つ**（`CLAUDE.md` §2-7・#1026）＝画面の文言を見る門番は
 * 禁止語のほかにも増える（戻る導線の言い方など）。それぞれが**見分け方**を書き写すと、
 * 片方だけ緩めてももう片方は黙って通し続ける（同じ型を `oneJapaneseMatcherGuard` で踏んでいる）。
 * ⚠️ **見分けは `scanTs` に寄せる**（#1142）＝説明・文字列・テンプレート・正規表現の見分けは
 * **TS を1回なぞる**側が持つ。ここは「拾った中から画面の文だけ選ぶ」に専念する。
 * ⚠️ **テンプレート文字列も拾う**＝以前は `'` と `"` だけを見ていたので、**同じ文言を
 * バッククォートで書くと禁止語の走査からも戻る導線の走査からも消えた**（#1141 で見つけた穴）。
 * 素朴に対を取るとバッククォートの対応が飛んで**128 件の巨大な塊**になるので、対にせず頭からなぞる。
 */
export function screenTextsIn(text: string): string[] {
  const { code, literals } = scanTs(text);
  const 記録 = devLogRanges(code);
  const seen = new Set<string>();
  const add = (raw: string): void => {
    const s = raw.trim();
    if (!s || !hasJapanese(s)) return;
    seen.add(s);
  };
  // ① 文字列・テンプレート（属性・変数・関数の引数）。
  // ⚠️ **開発用の記録は落とす**＝`console.warn("…がスキーマに未適合")` は画面に出ない。
  for (const l of literals) {
    if (記録.some(([from, to]) => l.at >= from && l.at < to)) continue;
    add(l.text);
  }
  // ② JSX のテキスト（タグとタグの間）。`{...}` の式は中身を見ない（識別子が混じるだけ）。
  // ⚠️ **`code` を見る**＝文字列の中身は空白になっているので、引用符の中の `>` `<` で切れない。
  // ⚠️ **記録の除外はここにも掛ける**（#1174 レビュー由来 ℹ️）＝いまは `console.*` の中身が
  // 空白になっているので日本語は残らないが、`devLogRanges` の射程を広げたときに**②だけ素通り**になる。
  for (const m of code.matchAll(/>([^<>{}]+)</g)) {
    if (記録.some(([from, to]) => m.index >= from && m.index < to)) continue;
    add(m[1]!);
  }
  return [...seen];
}
