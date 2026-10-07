// 場面を増やす道が、ひとつ残らず上限の関門を通っている（#1213）。**構造で留める**。
//
// ⚠️ **なぜ構造で見るか**＝**入口が5つある**（足す・複製・分ける×2・**AI の動画案を取り込む**）。
// 6つ目を足した人が関門を書き忘れても、**その道からだけ上限を越えられる**ようになり、
// **保存も読込もできるのに、外へ渡したときだけ弾かれる動画**ができる。
// ⚠️ **元の穴がまさにそれ**＝定数を見ていたのは**AI の出力を変換するとき1か所だけ**で、
// **手で足す道には関門が無かった**（#1213）。
// ⚠️ **そのあと、AI の道だけが残った**（#1222）＝`transformPlan` は81個以上でも**警告を積むだけ**で
// 場面を減らさないので、**AI 経由なら80を超えた動画が作れて**いた。**同じ定数なのに道で強さが違う**形。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const STORE = 'src/app/store/projectStore.ts';

/**
 * 場面を増やす操作（`projectStore` の口）と、その口が出す断り。ここに足したら、関門も足すこと。
 *
 * ⚠️ **断りの文は口によって違う**（#1222）＝手で足す道は「要らない場面を消す」が次の行動になるが、
 * **AI の動画案は1つも取り込んでいない**ので消す対象が無い（次の行動は「減らして作り直す」）。
 * だから**同じ文を使い回さない**＝口ごとにどの文を出すかまで留める。
 */
const ADDING_OPS = [
  { op: 'addScene', message: 'sceneLimitMessage()' },
  { op: 'duplicateScene', message: 'sceneLimitMessage()' },
  { op: 'splitScene', message: 'sceneLimitMessage()' },
  { op: 'splitSceneAtLine', message: 'sceneLimitMessage()' },
  // ⚠️ **AI の道**（#1222）＝`transformPlan` のあと、`set` で反映する**前**に断る。
  { op: 'generate', message: 'aiSceneLimitMessage(' },
] as const;

/**
 * その操作の**中身**（次の操作の定義が始まるまで）を取り出す。
 *
 * ⚠️ **型の宣言ではなく実装を採る**＝同じ名前が**型の並びにも**在る（`addScene: () => string;`）。
 * 宣言のほうを採ると、そこに関門が無いのは当たり前なので**いつでも赤い**＝門番として役に立たない。
 * 実装は `名前: (...) => {` の形なので、そこで見分ける。
 * ⚠️ **`async` も通す**（#1222）＝AI の道（`generate: async () => {`）は非同期なので、
 * `async` を見ないと**取り出せず、関門が無くても空振りで緑**になる。
 */
function bodyOf(src: string, op: string): string {
  const m = new RegExp(`\\n {2}${op}: (?:async )?\\([^)]*\\) => \\{`).exec(src);
  if (!m) return '';
  const after = src.slice(m.index + 1);
  const nextOp = after.search(/\n {2}[a-zA-Z_]+: (?:async )?\([^)]*\) => \{/);
  return nextOp < 0 ? after : after.slice(0, nextOp);
}

describe('場面を増やす道は、ひとつ残らず上限の関門を通る（#1213）', () => {
  // ⚠️ **走査そのものを検査する**＝取り出せていないのに緑、を防ぐ。
  it('すべての口を取り出せている', () => {
    const src = readFileSync(STORE, 'utf8');
    const empty = ADDING_OPS.filter(({ op }) => bodyOf(src, op).length < 50);
    expect(empty.map(({ op }) => op).join(', '), '`projectStore` から口を取り出せない（名前が変わった？）').toBe('');
  });

  it.each(ADDING_OPS)('`$op` は上限の関門を通る', ({ op }) => {
    const body = bodyOf(readFileSync(STORE, 'utf8'), op);
    expect(body.includes('canAddScenes('), `\`${op}\` に上限の関門が無い＝この道からだけ 80 を越えられる`).toBe(true);
  });

  // ⚠️ **断るだけで黙らない**＝理由を出さないと「押しても効かない」になる（ADR-0026④）。
  // ⚠️ **口ごとに、どの文かまで見る**（#1222）＝どちらでも緑にすると、
  //   **AI の道で「要らない場面を消してください」**（消す対象が無い）を出しても気づけない。
  it.each(ADDING_OPS)('`$op` は断るときに、その道の理由を出す', ({ op, message }) => {
    const body = bodyOf(readFileSync(STORE, 'utf8'), op);
    expect(body.includes(message), `\`${op}\` が黙って断っている（または別の道の文を使っている）`).toBe(true);
  });

  // ⚠️ **正の側をゆるめる変異は、ここが肩代わりする**（#1222 の変異チェックで生き残った）＝
  //   ⚠️ **「等価」ではなく「別の検査が被覆している」**（PR #1223 レビュー ℹ️＝言い方を直した）。
  //   上の判定を `includes('sceneLimitMessage')` までゆるめても、下の「ほかの道の文が無い」が
  //   本物の欠陥（AI の道で手で足すときの文を出す）を**赤で捕まえる**ことを実測で確かめた
  //  （両方の変異を同時に当てて `generate` の検査が落ちる）。だから検査は足さない。
  // ⚠️ **「持っている」だけでは見分けていない**（変異チェックで生き残った）＝
  //   `aiSceneLimitMessage` は `SceneLimitMessage` を**部分一致で含む**ので、
  //   ゆるい判定にすると**AI の道で手で足すときの文を出しても緑**になる。**他の道の文が無い**ことまで見る。
  // ⚠️ **将来 `aiSceneLimitMessage()`（引数なし）にすると誤検出する**（同レビュー ℹ️）＝
  //   `'sceneLimitMessage()'` を部分一致で含むので、AI の道が「ほかの道の文を使っている」と赤くなる。
  //   そのときは目印を関数名ではなく**呼び出しの形**（`aiSceneLimitMessage(` の `(` 込み）で持つこと。
  it.each(ADDING_OPS)('`$op` は、ほかの道の文を使っていない', ({ op, message }) => {
    const body = bodyOf(readFileSync(STORE, 'utf8'), op);
    const others = [...new Set(ADDING_OPS.map((o) => o.message))].filter((m) => m !== message);
    for (const other of others) {
      expect(body.includes(other), `\`${op}\` が別の道の文（${other}）を使っている`).toBe(false);
    }
    expect(others.length, '比べる相手が無い＝この検査は何も見ていない').toBeGreaterThan(0);
  });

  // ⚠️ **数え方を2か所に持たない**＝口の数が増減したら、この検査が落ちて気づける。
  it('口の数を実数で留める', () => {
    const src = readFileSync(STORE, 'utf8');
    expect(
      (src.match(/canAddScenes\(/g) ?? []).length,
      '上限の関門の数が変わった（口を足したか、外したか）',
    ).toBe(ADDING_OPS.length);
  });
});
