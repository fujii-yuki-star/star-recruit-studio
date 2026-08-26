// 層種別を**文字列リテラルで比べない**ための門番（#845）。
//
// `LayerType` は `LAYER_TYPE`（`domain/enums.ts`）という単一の参照元を持つのに、比較や `case` は
// `'character'` のような生の文字列で書かれていた（**比較40箇所＋`case` 8件**まで溜まっていた）。
// ⚠️ **型では守れない**＝`LAYER_TYPE.slot` の型は `'slot'` なので、生の `'slot'` と書いても通る。
// しかも**同じ綴りの別の語彙**（`LayoutItem.role` の `'slot'`／`FreeElement` 系の `kind`）があるため、
// 読む側は「どの語彙の話か」を型から判断できない。だから機械で留める（§2-7）。
//
// これは「直したことを将来も確認する手段」＝新しく生のリテラル比較が増えたらここで落ちる。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAYER_TYPES } from '../domain/enums';

const SRC = join(process.cwd(), 'src');
const TYPES = LAYER_TYPES.join('|');

/**
 * `x.type === 'character'` の形（`!==` も）。
 *
 * ⚠️ **`.type` に限る**＝`.kind` や `.role` は別の語彙で、同じ綴りでも意味が違う（巻き込むと
 * 直す先の無い赤が出る）。`case 'character':` は別に見る（下）。
 */
const COMPARISON = new RegExp(String.raw`\.type\s*(?:===|!==)\s*['"](?:` + TYPES + String.raw`)['"]`);
/** `switch (layer.type)` の頭。 */
const SWITCH_HEAD = /switch\s*\([^)]*\.type\s*\)/;
/** その本体の中の `case 'character':`。 */
const CASE_LITERAL = new RegExp(String.raw`case\s+['"](?:` + TYPES + String.raw`)['"]\s*:`);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    if (!/\.tsx?$/.test(e.name)) return [];
    // ⚠️ **テストは対象外**＝作為的な値を組む都合で生の文字列を書く（データを作るのは比較ではない）。
    if (/\.test\.tsx?$/.test(e.name)) return [];
    // 定義元そのもの（`LAYER_TYPE` を組み立てている場所）は当然リテラルを持つ。
    if (p.endsWith(join('domain', 'enums.ts'))) return [];
    return [p];
  });
}

/** `switch (…type)` の本体だけを取り出す（ほかの switch の case を巻き込まない）。 */
function switchBodies(src: string): string[] {
  const lines = src.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!SWITCH_HEAD.test(lines[i])) continue;
    let depth = 0;
    const body: string[] = [];
    for (let j = i; j < lines.length; j += 1) {
      depth += (lines[j].match(/\{/g) ?? []).length - (lines[j].match(/\}/g) ?? []).length;
      body.push(lines[j]);
      if (j > i && depth <= 0) break;
    }
    out.push(body.join('\n'));
  }
  return out;
}

describe('層種別を文字列リテラルで比べない（#845）', () => {
  it('`.type === "character"` のような生の比較が無い', () => {
    const offenders = sourceFiles(SRC)
      .filter((p) => COMPARISON.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(SRC.length + 1));
    // ⚠️ 落ちたら `LAYER_TYPE.character` へ置き換える（`domain/enums` から import）。
    expect(offenders).toEqual([]);
  });

  it('`switch (…type)` の `case` も生の文字列でない', () => {
    const offenders = sourceFiles(SRC)
      .filter((p) => switchBodies(readFileSync(p, 'utf8')).some((b) => CASE_LITERAL.test(b)))
      .map((p) => p.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('門番が実際に見えている（走査対象・正規表現が壊れたら落ちる）', () => {
    // ⚠️ 上の2つは**対象が0件でも・正規表現が何も拾わなくても緑**になる＝壊れたことに気づけない。
    // 実際この門番は最初 heredoc で書いたときに **`\.` が `.` に落ちて何も拾っていなかった**
    // （変異チェックで発覚）。**自分自身が効いていること**をここで確かめる。
    expect(sourceFiles(SRC).length).toBeGreaterThan(100);
    expect(LAYER_TYPES.length).toBe(8);
    expect(COMPARISON.test("const a = l.type === 'character';")).toBe(true);
    expect(CASE_LITERAL.test("      case 'background': {")).toBe(true);
    // 別の語彙は拾わない（`.kind`／`.role` は同じ綴りでも意味が違う）。
    expect(COMPARISON.test("const a = it.role === 'slot';")).toBe(false);
    expect(COMPARISON.test("const a = it.kind === 'text';")).toBe(false);
  });
});
