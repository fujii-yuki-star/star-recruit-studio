// `layer.textKey` を**直に見ない**（#1058）。解き方は `textKeyOfLayer` に1か所（§2-7）。
//
// ⚠️ **同じ食い違いを3回踏んだ**＝`textKeyOfLayer` の JSDoc は「既定の解き方はここだけ」と書いているのに、
// 描画（`layout.ts`・#1057）・数える側（`subtitleBinding`）・見本（`looksShared`）が直に見ていた。
// **字幕層の `textKey` 未指定は `subtitle`** なので、直に見ると「欄はあるのに描かれない」「数え落とす」が起きる。
// 人が気づく形にせず、**次に足した所で赤くする**。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 走査から外すファイル（**理由を書く**＝空欄で増やせないよう検査する）。 */
const EXEMPT: Record<string, string> = {
  'layerOps.ts': '解き方そのものを持つ場所（`textKeyOfLayer` の定義と、層を作るときの既定）',
};

/** `<何か>.textKey` を**読んでいる**所（`textKey:` の書き込みと、型宣言は除く）。 */
export function directTextKeyReads(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('//')) continue; // コメントは対象外
    for (const m of line.matchAll(/([A-Za-z_$][\w$]*)\.textKey\b/g)) out.push(`${m[1]}.textKey`);
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !name.includes('.test.')) out.push(p);
  }
  return out;
}

describe('textKey の解き方は1か所（#1058）', () => {
  const files = walk(join(process.cwd(), 'src'));

  it('`layer.textKey` を直に読んでいる所が無い', () => {
    const hits: string[] = [];
    for (const p of files) {
      const name = basename(p);
      if (name in EXEMPT) continue;
      const found = directTextKeyReads(readFileSync(p, 'utf8'));
      if (found.length > 0) hits.push(`${name}: ${[...new Set(found)].join(', ')}`);
    }
    expect(hits, '`textKeyOfLayer` を通すか、理由つきで EXEMPT へ').toEqual([]);
  });

  it('外した理由が空でない', () => {
    for (const [name, why] of Object.entries(EXEMPT)) expect(why.length, `${name} の理由が空`).toBeGreaterThan(0);
  });

  // ⚠️ **門番そのものを見る**（`guard-gets-holes`）＝拾い方が壊れても緑のままにしない。
  it('書き込みとコメントは拾わない／読みは拾う（拾い方を直接見る）', () => {
    expect(directTextKeyReads('const x = { textKey: "title" };')).toEqual([]);
    expect(directTextKeyReads('  // layer.textKey を直に見ない')).toEqual([]);
    expect(directTextKeyReads('   * `layer.textKey` の話')).toEqual([]);
    expect(directTextKeyReads('if (layer.textKey) return layer.textKey;')).toEqual(['layer.textKey', 'layer.textKey']);
  });
});
