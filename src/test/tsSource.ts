// TypeScript / TSX のソースを**1回だけ**なぞって、説明・文字列・テンプレート・正規表現を見分ける道具（検査用）。
//
// ⚠️ **Rust 側と同じ流儀**（`src/test/rustSource.ts`・#1111）＝素朴に引用符を対にすると、
// 途中の1つで**対応が反転**して、そのファイルの残りが丸ごと門番の外に落ちる。
// Rust では実際に踏んだ（文字リテラル `'"'` で `ffmpeg.rs` の半分以上が見えていなかった）。
//
// ⚠️ **TS ではテンプレート文字列がその役目をする**（#1142）＝`` ` `` は
// **文字列の中・正規表現のリテラル・説明の外し残り**にも現れるので、素朴に対にすると
// 離れた2つが1つの塊になる（#1141 で実際に試したら、画面の文言として**128 件**の巨大な塊が上がった）。
//
// ⚠️ **だから「対を取る」のをやめて、頭からなぞる**＝いま何の中にいるかを持って進む。

/** 1つの文字列（中身と、ソース上の開始位置）。 */
export interface TsLiteral {
  /** 引用符の間の生の中身（エスケープはそのまま）。テンプレートは `${…}` で割った**かけら**。 */
  text: string;
  /**
   * 中身が始まる位置（`code` と同じ座標系＝長さを保っているので突き合わせられる）。
   *
   * ⚠️ **種類で指す所が違う**（PR #1174 レビュー ℹ️）＝`"`/`'` は**引用符そのもの**、
   * テンプレートのかけらは**中身の先頭**（開き `` ` `` や `${…}` を閉じる `}` の次）。
   * いまの使い道（`uiTerms.ts` の記録の範囲と重なるか）はどちらでも同じ答えになる。
   */
  at: number;
  /** `"`/`'` か、テンプレート（`` ` ``）か。 */
  kind: "string" | "template";
}

export interface TsScan {
  /**
   * 説明・文字列の中身・正規表現を**空白に置き換えた**本文。
   *
   * ⚠️ **長さと行を保つ**＝元のソースと**同じ座標**で読める（行番号も、位置の突き合わせも狂わない）。
   * ⚠️ **JSX のタグは残す**＝タグとタグの間の文（`<p>まだありません</p>`）は
   *   引用符の中に無いので、ここを見て拾う側がある。
   */
  code: string;
  /** 見つかった文字列（出てきた順）。 */
  literals: TsLiteral[];
}

/**
 * その `/` が**正規表現の始まり**か（割り算ではないか）。
 *
 * ⚠️ **見分けないと、割り算から「正規表現が始まった」ことになる**＝次の `/` までが
 * 丸ごと消え、その間の文字列が門番の外へ落ちる（Rust の `'"'` と同じ型）。
 * ⚠️ **JSX を知らないと、広げたつもりで狭まる**（#1174 レビュー由来 🔴）＝
 * `<Icon … />` の `/` と `</p>` の `/` を正規表現の始まりと読むと、**タグの後ろの画面の文が
 * 丸ごと落ちる**。実測で 43 件（うち 28 件は実在の画面ラベル）が消えていた。
 * ⚠️ **判定は3つ**＝①次が `>` なら自己終了タグ ②直前の実のある文字が `<` なら閉じタグ
 * ③識別子・数字・`)`・`]` の後ろなら**割り算**（`return`／`typeof`／`case`／`in`／`of` は除く）。
 */
function 正規表現の始まり(code: string, src: string, at: number): boolean {
  if (src[at + 1] === ">") return false; // `<Icon … />`＝自己終了タグ
  // ⚠️ **`/[` は割り算ではない**（PR #1174 再レビュー）＝文字の組（`[...]`）でしか始まらない形。
  //   ここを見分けないと、**中身の引用符で対応が反転**して**後ろの画面の文まで落ちる**
  //  （`function f() {} /["]/.test(x); const m = "見つかりません";` で実際に落ちた）。
  //   下の `}` の見分けは「割り算・JSX の本文」側へ倒しているので、その取りこぼしをここで拾う。
  if (src[at + 1] === "[") return true;
  let k = at - 1;
  while (k >= 0 && /\s/.test(code[k]!)) k -= 1;
  if (k < 0) return true;
  const c = code[k]!;
  if (c === "<") return false; // `</p>`＝閉じタグ
  // ⚠️ **`}` の後ろは割り算・JSX の本文**（#1174 レビュー由来）＝この repo に実在する
  //（`場面 {i} / {n}`・`<span>{title.length}/{MAX}</span>`）。正規表現と読むと、
  //   `</span>` の `/` までを丸ごと落として**タグの対応が狂う**。
  // ⚠️ **取りこぼす形**＝`if (x) {} /re/.test(y)` のように**ブロックの直後の正規表現**。
  //   この repo に 0 件。⚠️ **「落とすのは正規表現の中身だけ」は嘘だった**（PR #1174 再レビュー）＝
  //   中身に引用符があると**対応が反転して後ろの画面の文まで落ちる**ので、上の `/[` で拾っている。
  if (c === "}") return false;
  // ⚠️ **日本語の直後は正規表現ではない**（#1174）＝JSX の本文（`見出し/本文`・`場面 1/3`）にだけ
  //   現れる形。TS の文法では、日本語の直後に正規表現が来ることはない。
  if (c.charCodeAt(0) > 0x7f) return false;
  if (/[A-Za-z0-9_$)\]]/.test(c)) {
    // `return /…/` `typeof /…/` のように**語の後ろでも正規表現**になる綴りがある。
    const word = /[A-Za-z_$][A-Za-z0-9_$]*$/.exec(code.slice(0, k + 1))?.[0];
    return word === "return" || word === "typeof" || word === "case" || word === "in" || word === "of";
  }
  return true;
}

/**
 * TypeScript / TSX のソースを1回なぞって、説明・文字列・テンプレート・正規表現を見分ける。
 *
 * ⚠️ **説明の中の語で赤くしない**＝門番が誤検出すると信用を落とす
 *（`// テンプレートは素材として置く` と書いた瞬間に落ちる門番は使えない）。
 * ⚠️ **文字列の中の `//` を行の説明と取り違えない**＝`"http://…"` でその行の残りが見えなくなる
 *（見落とす側に倒れるので、赤くならないまま穴が開く）。
 * ⚠️ **テンプレートの `${…}` の中は「本文」として読む**＝そこに書けるのは式なので、
 *   中の文字列・テンプレート・正規表現もこの関数がそのまま見分ける（入れ子を数える）。
 * ⚠️ **テンプレートは `${…}` で割ったかけらを1つずつ持つ**＝
 *   `` `見つかりません（${n}件）。選び直してください` `` は「見つかりません（」と「件）。選び直してください」。
 *   繋げてしまうと**存在しない文**ができる（`${…}` の前後は別の文）。
 */
export function scanTs(src: string): TsScan {
  let code = "";
  const literals: TsLiteral[] = [];
  /** 元の並びと同じ長さだけ空白（改行はそのまま）を書く。 */
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) code += src[k] === "\n" ? "\n" : " ";
  };
  /** そのまま写す。 */
  const keep = (from: number, to: number): void => {
    code += src.slice(from, to);
  };

  let i = 0;

  /** テンプレートを1つ読む（開きの `` ` `` の位置から）。閉じた次の位置を返す。 */
  const テンプレートを読む = (open: number): number => {
    let j = open + 1;
    let かけら = "";
    let から = j;
    blank(open, j);
    for (;;) {
      if (j >= src.length) break;
      const c = src[j]!;
      if (c === "\\") {
        かけら += src.slice(j, j + 2);
        blank(j, Math.min(j + 2, src.length));
        j += 2;
        continue;
      }
      if (c === "`") {
        literals.push({ text: かけら, at: から, kind: "template" });
        blank(j, j + 1);
        return j + 1;
      }
      if (c === "$" && src[j + 1] === "{") {
        literals.push({ text: かけら, at: から, kind: "template" });
        かけら = "";
        // ⚠️ **中は本文**＝式なので、そのまま写して次の走査に任せる（入れ子はここで数える）。
        keep(j, j + 2);
        j += 2;
        let depth = 1;
        while (j < src.length && depth > 0) {
          const d = src[j]!;
          if (d === "{") {
            depth += 1;
            keep(j, j + 1);
            j += 1;
            continue;
          }
          if (d === "}") {
            depth -= 1;
            keep(j, j + 1);
            j += 1;
            continue;
          }
          if (d === "`") {
            j = テンプレートを読む(j);
            continue;
          }
          if (d === '"' || d === "'") {
            j = 引用符を読む(j, d);
            continue;
          }
          if (src.slice(j, j + 2) === "//") {
            const s0 = j;
            while (j < src.length && src[j] !== "\n") j += 1;
            blank(s0, j);
            continue;
          }
          // ⚠️ **中でも外と同じ見分けをする**（#1174 レビュー由来 🟡）＝以前は `/` を素通しに
          // していたので、`${s.replace(/['\"]/g, "")}` で**対応が反転**し、後ろの本物の文言まで
          // 巻き添えにした（この道具がいちばん断ちたかった形が、中だけ残っていた）。
          if (src.slice(j, j + 2) === "/*") {
            const s1 = j;
            j += 2;
            while (j < src.length && src.slice(j, j + 2) !== "*/") j += 1;
            j = Math.min(j + 2, src.length);
            blank(s1, j);
            continue;
          }
          if (d === "/" && 正規表現の始まり(code, src, j)) {
            j = 正規表現を読む(j);
            continue;
          }
          keep(j, j + 1);
          j += 1;
        }
        から = j;
        continue;
      }
      かけら += c;
      blank(j, j + 1);
      j += 1;
    }
    literals.push({ text: かけら, at: から, kind: "template" });
    return j;
  };

  /**
   * 正規表現のリテラルを1つ読む（`/` の位置から）。次の位置を返す。
   *
   * ⚠️ **中の `` ` `` や引用符で対応を飛ばさないよう、丸ごと落とす**。
   * ⚠️ **閉じていなければ落とさない**（#1174 レビュー由来 🔴）＝割り算だったということなので、
   * `/` を本文として写して読み直す。以前はここで**行末まで落として**いて、
   * 「落としすぎない側へ倒す」と書いたコメントと**実装が逆**だった。
   */
  const 正規表現を読む = (open: number): number => {
    let j = open + 1;
    let かっこ = false;
    let 閉じた = false;
    while (j < src.length) {
      const d = src[j]!;
      if (d === "\\") {
        j += 2;
        continue;
      }
      if (d === "\n") break;
      if (d === "[") かっこ = true;
      else if (d === "]") かっこ = false;
      else if (d === "/" && !かっこ) {
        j += 1;
        閉じた = true;
        break;
      }
      j += 1;
    }
    if (!閉じた) {
      keep(open, open + 1);
      return open + 1;
    }
    while (j < src.length && /[a-z]/.test(src[j]!)) j += 1; // 末尾の g・i・m・s・u・y
    blank(open, j);
    return j;
  };

  /** `"` / `'` の文字列を1つ読む（開きの位置から）。閉じた次の位置を返す。 */
  const 引用符を読む = (open: number, quote: string): number => {
    let j = open + 1;
    const から = j;
    while (j < src.length && src[j] !== quote) {
      if (src[j] === "\n") break; // 素の文字列は行をまたがない＝閉じ忘れで暴走させない
      j += src[j] === "\\" ? 2 : 1;
    }
    const 終 = Math.min(j, src.length);
    literals.push({ text: src.slice(から, 終), at: open, kind: "string" });
    const to = src[終] === quote ? 終 + 1 : 終;
    blank(open, to);
    return to;
  };

  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      const start = i;
      while (i < src.length && src[i] !== "\n") i += 1;
      blank(start, i);
      continue;
    }
    if (two === "/*") {
      const start = i;
      i += 2;
      while (i < src.length && src.slice(i, i + 2) !== "*/") i += 1;
      i = Math.min(i + 2, src.length);
      blank(start, i);
      continue;
    }
    const c = src[i]!;
    if (c === '"' || c === "'") {
      i = 引用符を読む(i, c);
      continue;
    }
    if (c === "`") {
      i = テンプレートを読む(i);
      continue;
    }
    if (c === "/" && 正規表現の始まり(code, src, i)) {
      i = 正規表現を読む(i);
      continue;
    }
    keep(i, i + 1);
    i += 1;
  }
  return { code, literals };
}
