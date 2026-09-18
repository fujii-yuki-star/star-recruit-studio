// 場面を増やす道が、ひとつ残らず上限の関門を通っている（#1213）。**構造で留める**。
//
// ⚠️ **なぜ構造で見るか**＝**入口が4つある**（足す・複製・分ける×2）。
// 5つ目を足した人が関門を書き忘れても、**その道からだけ上限を越えられる**ようになり、
// **保存も読込もできるのに、外へ渡したときだけ弾かれる動画**ができる。
// ⚠️ **元の穴がまさにそれ**＝定数を見ていたのは**AI の出力を変換するとき1か所だけ**で、
// **手で足す道には関門が無かった**。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const STORE = 'src/app/store/projectStore.ts';

/** 場面を増やす操作（`projectStore` の口）。ここに足したら、関門も足すこと。 */
const ADDING_OPS = ['addScene', 'duplicateScene', 'splitScene', 'splitSceneAtLine'] as const;

/**
 * その操作の**中身**（次の操作の定義が始まるまで）を取り出す。
 *
 * ⚠️ **型の宣言ではなく実装を採る**＝同じ名前が**型の並びにも**在る（`addScene: () => string;`）。
 * 宣言のほうを採ると、そこに関門が無いのは当たり前なので**いつでも赤い**＝門番として役に立たない。
 * 実装は `名前: (...) => {` の形なので、そこで見分ける。
 */
function bodyOf(src: string, op: string): string {
  const m = new RegExp(`\\n {2}${op}: \\([^)]*\\) => \\{`).exec(src);
  if (!m) return '';
  const after = src.slice(m.index + 1);
  const nextOp = after.search(/\n {2}[a-zA-Z_]+: \([^)]*\) => \{/);
  return nextOp < 0 ? after : after.slice(0, nextOp);
}

describe('場面を増やす道は、ひとつ残らず上限の関門を通る（#1213）', () => {
  // ⚠️ **走査そのものを検査する**＝取り出せていないのに緑、を防ぐ。
  it('4つの口をすべて取り出せている', () => {
    const src = readFileSync(STORE, 'utf8');
    const empty = ADDING_OPS.filter((op) => bodyOf(src, op).length < 50);
    expect(empty.join(', '), '`projectStore` から口を取り出せない（名前が変わった？）').toBe('');
  });

  it.each(ADDING_OPS)('`%s` は上限の関門を通る', (op) => {
    const body = bodyOf(readFileSync(STORE, 'utf8'), op);
    expect(
      body.includes('canAddScenes('),
      `\`${op}\` に上限の関門が無い＝この道からだけ ${'80'} を越えられる`,
    ).toBe(true);
  });

  // ⚠️ **断るだけで黙らない**＝理由を出さないと「押しても効かない」になる（ADR-0026④）。
  it.each(ADDING_OPS)('`%s` は断るときに理由を出す', (op) => {
    const body = bodyOf(readFileSync(STORE, 'utf8'), op);
    expect(body.includes('sceneLimitMessage()'), `\`${op}\` が黙って断っている`).toBe(true);
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
