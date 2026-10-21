// 文字の字体の渡し忘れの門番（ADR-0063）。
//
// ⚠️ **`layoutScene` は字体（`projectFontId`）を省略できる**（検査が `layoutScene(scene, template)` と
// 書けるように）。そのぶん**本番の呼び出しで渡し忘れると、動画全体の字体が効かず既定の字体で描かれる**
// （描く字体と折返しの字幅は `TextItem.textFont` の1つから出るので食い違いはしないが、字体そのものが違う）。
// 型では捕まらないので、本番の呼び出しを全部なぞって `projectFontId` を渡しているかを見る。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanTs } from './tsSource';

/**
 * 渡さなくてよい呼び出し（**文字を読まない**ことが説明できるものだけ）。
 * ⚠️ 迷ったら足さない＝渡すほうを直す。
 */
const ALLOWED: Record<string, string> = {
  // 動画の差し込み口（絵のアイテム）の位置だけを読む＝文字のアイテムは見ない。
  'src/renderer/export/videoSlotPlacement.ts': '絵の位置だけ',
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

/** `layoutScene(` の呼び出しの引数（括弧の中身）を取り出す。定義（`function layoutScene(`）は除く。 */
function callsIn(code: string): string[] {
  const out: string[] = [];
  const re = /(?<![\w.])layoutScene\(/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (/function\s+$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue;
    let depth = 1;
    let k = m.index + m[0].length;
    while (depth > 0 && k < code.length) {
      const c = code[k];
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      k += 1;
    }
    out.push(code.slice(m.index + m[0].length, k - 1));
  }
  return out;
}

const files = walk('src').map((p) => relative('.', p).split(sep).join('/'));
const found = files.flatMap((file) =>
  callsIn(scanTs(readFileSync(file, 'utf8')).code).map((args) => ({ file, args })),
);

describe('layoutScene の本番の呼び出しは動画全体の字体を渡す（ADR-0063）', () => {
  it('走査そのものが効いている（呼び出しを実際に数えている）', () => {
    // ⚠️ **実数で留める**＝0件でも緑になる門番にしない。呼び出しが増減したらここを直す（新しい呼び出しを見たことになる）。
    expect(found.length).toBe(16);
  });

  it('`projectFontId` を渡していない呼び出しがない', () => {
    const missing = found
      .filter(({ file, args }) => !(file in ALLOWED) && !/\bprojectFontId\b/.test(args))
      .map(({ file, args }) => `${file}: layoutScene(${args.replace(/\s+/g, ' ').slice(0, 80)})`);
    expect(missing).toEqual([]);
  });

  it('見逃してよい呼び出しの一覧に、もう無いものが残っていない', () => {
    for (const file of Object.keys(ALLOWED)) expect(found.some((f) => f.file === file), file).toBe(true);
  });
});
