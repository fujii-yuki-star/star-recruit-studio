// 画面が使っている「見た目のクラス」と、CSS にある規則を突き合わせるための拾い方（#1246・ADR-0047 決定5）。
//
// ⚠️ **クラス名だけが約束をしていた**＝`btn-sm` は4ファイル・12か所で使われていたのに、CSS に規則が
// **1つも無かった**。「ここは小さいボタンにしてある」と読めるコードが、実際には普通の大きさを出していた。
// 型でも lint でも落ちず、レビューも「クラスがあるから効いているのだろう」で通る。
//
// ⚠️ **拾い方をここへ出す**（`uiTerms.ts` と同じ流儀）＝走る所と自己検査が別の道だと、
// 走る所だけ狭めても自己検査は緑のままになる（実際にそうなった前例がある＝#1026）。
//
// ⚠️ **静的に書かれたものだけを見る**＝`className={"a " + kind}` のように**組み立てる名前**は
// 追えない。追えないものを当てずっぽうで拾うと誤検出になり、門番の信用が落ちる（`/issue-drive` の原則）。
// 組み立ての断片（末尾が `-` で終わるもの）は**対象外**として構造で外す。

/** 末尾が `-` ＝ 組み立ての断片（`` `timeline-clip--${kind}` `` の前半）。 */
function isFragment(token: string): boolean {
  return token.endsWith("-");
}

/** クラス名として扱える形か（数字始まり・記号混じりは対象外）。 */
function isClassName(token: string): boolean {
  return /^[a-zA-Z][\w-]*$/.test(token) && !isFragment(token);
}

/**
 * JSX の `className` に**直に書かれた**クラス名。
 *
 * 拾うのは `className="…"` / `className={"…"}` / ``className={`…`}`` の3つ。
 * テンプレートの差し込み（`${…}`）は**空白に置き換える**＝差し込みの前後がくっついて
 * 別のクラス名に見えるのを防ぐ。
 */
export function classNamesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, " ");
    for (const token of raw.split(/\s+/)) {
      if (isClassName(token)) out.push(token);
    }
  }
  return out;
}

/** CSS の中で**規則が書かれている**クラス名（`.foo { … }` の `foo`）。 */
export function cssClassesIn(text: string): string[] {
  // ⚠️ **中身を消してから探す**＝`content: ".x"` のような値を規則と数えない。
  const withoutValues = text.replace(/\{[^}]*\}/g, " ");
  return [...withoutValues.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
}

/**
 * JS から**目印として**使っているクラス名（`querySelector('.foo')` など）。
 *
 * ⚠️ **見た目を持たないクラスは在ってよい**＝掴む所を指すためだけの名前がある
 *（`free-layout-overlay` は10か所から選択子として使われている）。これを「CSS に無い」と断ると誤検出になる。
 * ⚠️ **一覧で外さない**＝「この名前は見逃す」を手で並べると、次に足された分が黙って素通りする。
 * 選択子として**実際に使われている**ことを見る。
 */
export function selectorClassesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:querySelector(?:All)?|closest|matches|getElementsByClassName)\s*\(\s*(["'`])([^"'`]*)\1/g)) {
    for (const cm of m[2].matchAll(/\.([a-zA-Z][\w-]*)/g)) out.push(cm[1]);
    // getElementsByClassName は `.` を付けない
    for (const token of m[2].split(/\s+/)) if (isClassName(token)) out.push(token);
  }
  return out;
}

/**
 * 約束だけして実体が無いクラス（＝画面が使っているのに、CSS にも目印にも無いもの）。
 *
 * @returns 名前の昇順。空なら食い違いなし。
 */
export function unknownClasses(used: Iterable<string>, defined: Iterable<string>, hooks: Iterable<string>): string[] {
  const have = new Set([...defined, ...hooks]);
  return [...new Set([...used])].filter((c) => !have.has(c)).sort();
}
