// Rust のソースを**1回だけ**なぞって、注記・文字列・文字リテラルを見分ける道具（検査用）。
//
// ⚠️ **写して増やさない**（#1111）＝2つの門番が同じ見分けを要る。
// `noWindowSpawnGuard`（直呼びを探す＝**注記と文字列を落とした本文**が要る）と
// `rustUserMessageGuard`（画面へ返す文を探す＝**文字列の中身**が要る）。
// 別々に書いたら、片方だけが罠を踏んだ（下の `'"'` の件）。
//
// ⚠️ **実際に踏んだ**（2026-09-10）＝素朴に `"` を対にして数えると、`ffmpeg.rs:2254` の
// **文字リテラル `'"'`**（保存名に使えない文字の判定）でそこから**対応が反転**し、
// **その行より後ろの文字列を1つも拾えなくなっていた**。`ffmpeg.rs` は 7000 行あるので、
// 画面へ返す文の**半分以上が門番の外**にいた（気づいたのは別の作業で偶然）。

/** 1つの文字列リテラル（中身と、ソース上の開始位置）。 */
export interface RustLiteral {
  /** `"` と `"` の間の生の中身（エスケープはそのまま）。 */
  text: string;
  /** 開始の `"` の位置（`code` と同じ座標系＝長さを保っているので突き合わせられる）。 */
  at: number;
}

export interface RustScan {
  /**
   * 注記・文字列の中身・文字リテラルを**空白に置き換えた**本文。
   *
   * ⚠️ **長さと行を保つ**＝元のソースと**同じ座標**で読める（行番号も、位置の突き合わせも狂わない）。
   */
  code: string;
  /** 見つかった文字列リテラル（出てきた順）。 */
  literals: RustLiteral[];
}

/**
 * Rust のソースを1回なぞって、注記・文字列・文字リテラルを見分ける。
 *
 * ⚠️ **注記の中の語で赤くしない**＝門番が誤検出すると信用を落とす
 * （`// Command::new を直に呼ばない` と書いた瞬間に落ちる門番は使えない）。
 * ⚠️ **注記は入れ子になれる**（Rust のブロック注記は中にもう1つ書ける）＝深さを数える。
 * ⚠️ **文字列の中も落とす**＝`"http://127.0.0.1"` の `//` を行注記と取り違えると、
 * **その行の残りが見えなくなる**（見落とす側に倒れる）。
 * ⚠️ **`'"'` のような文字リテラルを飛ばす**＝この repo に実在し、素通しすると中の `"` から
 * **文字列が始まったことになって以降が全部消える**。
 * ⚠️ **生の文字列（`r#"…"#`）も見分ける**＝中に `"` を書けるので、素通しすると同じ形で反転する。
 */
export function scanRust(src: string): RustScan {
  let code = "";
  const literals: RustLiteral[] = [];
  /** 元の並びと同じ長さだけ空白（改行はそのまま）を書く。 */
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) code += src[k] === "\n" ? "\n" : " ";
  };
  let i = 0;
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
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src.slice(i, i + 2) === "/*") { depth += 1; i += 2; continue; }
        if (src.slice(i, i + 2) === "*/") { depth -= 1; i += 2; continue; }
        i += 1;
      }
      blank(start, i);
      continue;
    }
    // 生の文字列（`r"…"` / `r#"…"#`）＝中の `"` で終わらない。
    // ⚠️ **見分けないと、埋め込みの `"` から対応が反転する**（`'"'` と同じ型・レビュー由来 🟡）。
    const raw = /^r(#*)"/.exec(src.slice(i, i + 16));
    if (raw) {
      const open = i;
      const close = `"${raw[1]}`;
      const from = i + raw[0].length;
      const end = src.indexOf(close, from);
      const to = end < 0 ? src.length : end + close.length;
      literals.push({ text: src.slice(from, end < 0 ? src.length : end), at: open });
      blank(open, to);
      i = to;
      continue;
    }
    if (src[i] === '"') {
      const open = i;
      i += 1;
      const from = i;
      while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
      literals.push({ text: src.slice(from, Math.min(i, src.length)), at: open });
      i = Math.min(i + 1, src.length);
      blank(open, i);
      continue;
    }
    const charLit = /^'(?:\\.|[^\\'])'/.exec(src.slice(i, i + 4));
    if (charLit) {
      blank(i, i + charLit[0].length);
      i += charLit[0].length;
      continue;
    }
    code += src[i];
    i += 1;
  }
  return { code, literals };
}

/** 注記と文字列の中身を落とした本文（行数と長さは保つ）。 */
export function stripRustCommentsAndStrings(src: string): string {
  return scanRust(src).code;
}

/**
 * `name!( … )` の呼び出しが占める範囲（`code` の座標）。
 *
 * ⚠️ **落とした後の本文の上で数える**＝文字列の中の `(` `)` に釣られない
 *（`tlog!("t", "{}", format!("中の文。"))` のような書き方で切り上げてしまう）。
 */
export function macroCallRanges(code: string, names: readonly string[]): [number, number][] {
  const out: [number, number][] = [];
  for (const name of names) {
    const head = `${name}!(`;
    let from = 0;
    for (;;) {
      const at = code.indexOf(head, from);
      if (at < 0) break;
      let depth = 0;
      let j = at + head.length - 1;
      for (; j < code.length; j += 1) {
        if (code[j] === "(") depth += 1;
        else if (code[j] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      out.push([at, j]);
      from = j + 1;
    }
  }
  return out;
}
