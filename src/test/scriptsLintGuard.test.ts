// `scripts/**` に **lint と型検査が当たっている**ことの門番（#1235・PR #1238 レビュー 🟡）。
//
// ⚠️ **なぜ要るか**＝#1235 は「設定に規則が1つも当たっていないのに、`eslint` が緑を返す」という
// 不具合だった。実害として `scripts/lib/frames.mjs` から `const out = [];` が落ちたまま通っている。
// **直したあとも、`extends: [js.configs.recommended]` の1行を消せば同じ状態に戻り、
// `eslint .` も `npm test` も緑のまま**＝設定は「壊れても赤くならない」場所なので、ここで見る。
//
// ⚠️ **規則の一覧を写さない**＝`ESLint#calculateConfigForFile` で**実際に解決された設定**を見る
//（写すと、設定を変えたのに門番だけ古いまま、が起きる）。
//
// ⚠️ **見るのは「当たっているか」だけ**＝どの規則をどう設定するかは `eslint.config.js` の仕事。
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

/** 解決された設定から、その規則の重大度を取り出す（`0/1/2` と `'off'/'warn'/'error'` の両方が来る）。 */
export function severityOf(config: { rules?: Record<string, unknown> }, rule: string): string {
  const entry = config.rules?.[rule];
  const level = Array.isArray(entry) ? entry[0] : entry;
  if (level === 2 || level === 'error') return 'error';
  if (level === 1 || level === 'warn') return 'warn';
  return 'off';
}

describe('scripts/** に lint が当たっている（#1235）', () => {
  const eslint = new ESLint();

  // ⚠️ **これが #1235 の当の穴**＝`no-undef` が無いと、未定義の変数を触っても緑になる。
  it('道具の .mjs に `no-undef` が error で当たっている', async () => {
    const config = await eslint.calculateConfigForFile('scripts/lib/frames.mjs');
    expect(severityOf(config, 'no-undef'), '規則が当たっていない＝#1235 の状態に戻っている').toBe('error');
  });

  it('道具の .mjs に `no-unused-vars` が error で当たっている', async () => {
    const config = await eslint.calculateConfigForFile('scripts/tutorialRecord.mjs');
    expect(severityOf(config, 'no-unused-vars')).toBe('error');
  });

  // ⚠️ **検査ファイルでも外れていない**＝後から足したブロックが前のブロックを打ち消す形は、
  //   flat config で実際に起こしやすい（`languageOptions` は合流するが `rules` は上書きされる）。
  it('道具の検査ファイルでも外れていない', async () => {
    const config = await eslint.calculateConfigForFile('scripts/lib/cursor.test.mjs');
    expect(severityOf(config, 'no-undef'), '検査ファイルだけ素通しになっている').toBe('error');
  });

  // ⚠️ **`.ts` には素の規則を当てない**（PR #1238 レビュー 🟡）＝`tseslint` が型で見るために
  //   **意図的に切っている**ので、当て直すと `NodeJS.Timeout` や enum が理由なく赤になる。
  it('道具の .ts には、素の `no-undef` を当てない（型の側で見る）', async () => {
    const config = await eslint.calculateConfigForFile('scripts/adr0001-spike.ts');
    expect(severityOf(config, 'no-undef'), '素の規則が復活している＝理由のない赤が出る').toBe('off');
    expect(severityOf(config, '@typescript-eslint/no-unused-vars'), 'TS 側の規則が当たっていない').toBe('error');
  });

  // ⚠️ **`off` を見るだけでは、ブロックを消しても通る**（PR #1238 2回目 🟡）＝`off` は**既定値**。
  //   `.ts` 向けブロックの仕事は「node のグローバルを足す」ことなので、**それを見る**。
  it('道具の .ts に、node のグローバルが足されている', async () => {
    const tool = await eslint.calculateConfigForFile('scripts/adr0001-spike.ts');
    expect(tool.languageOptions?.globals?.process, 'node のグローバルが足されていない').toBeDefined();
    // アプリ側には足さない（browser のまま）＝ブロックの `files` が広がっていないことの裏。
    const app = await eslint.calculateConfigForFile('src/domain/enums.ts');
    expect(app.languageOptions?.globals?.process, 'アプリ側まで node 扱いになっている').toBeUndefined();
  });

  // ⚠️ **見ている先が実在するか**（同 ℹ️）＝`calculateConfigForFile` は**無いパスでも設定を返す**ので、
  //   ファイルが改名されても門番は緑のまま「当たっている」と言い続ける。
  it('見ているファイルが実在する', () => {
    for (const f of ['scripts/lib/frames.mjs', 'scripts/tutorialRecord.mjs', 'scripts/lib/cursor.test.mjs', 'scripts/adr0001-spike.ts']) {
      expect(existsSync(f), `${f} が無い＝門番が見ている先が消えている`).toBe(true);
    }
  });
});

describe('scripts/** に型検査が当たっている（#1235）', () => {
  const CONFIG = 'tsconfig.scripts.json';

  /**
   * その tsconfig が**実際に見るファイルの一覧**。
   *
   * ⚠️ **JSON の字面を見ない**（PR #1238 2回目 🟡）＝`include` に glob が載っていることを見るだけだと、
   * あとから `exclude` や `files` が足されて**対象が0件**になっても緑のまま。
   * ⚠️ **`JSON.parse` も使わない**＝この repo は tsconfig に**コメントを書く流儀**（`tsconfig.json` を参照）で、
   * 同じ書き方をした瞬間に**理由の分からない赤**になる。TypeScript 自身に読ませる。
   */
  const resolved = (() => {
    const read = ts.readConfigFile(CONFIG, ts.sys.readFile);
    expect(read.error, `${CONFIG} を読めない`).toBeUndefined();
    return ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(resolve(CONFIG)));
  })();

  it('道具向けの tsconfig がある', () => {
    expect(existsSync(CONFIG), `${CONFIG} が無い`).toBe(true);
    expect(resolved.errors, '設定の読み取りで落ちている').toEqual([]);
  });

  // ⚠️ **`checkJs` が無いと、`.mjs` は置いてあるだけで一切見られない**（拡張子だけ拾って中身は素通り）。
  it('`allowJs` と `checkJs` が入っている', () => {
    expect(resolved.options.allowJs).toBe(true);
    expect(resolved.options.checkJs, 'checkJs が無い＝置いてあるだけで見ていない').toBe(true);
  });

  // ⚠️ **「実際に見るファイル」で数える**＝設定の書き方が変わっても、対象が消えれば赤くなる。
  it('`scripts/**` の .mjs と .ts の両方を、実際に見ている', () => {
    const inScripts = resolved.fileNames.filter((f) => f.includes('/scripts/') || f.includes(`${sep}scripts${sep}`));
    const mjs = inScripts.filter((f) => f.endsWith('.mjs'));
    const tsFiles = inScripts.filter((f) => f.endsWith('.ts'));
    expect(mjs.length, '道具の .mjs を1つも見ていない').toBeGreaterThan(5);
    expect(tsFiles.length, '.ts の道具がどの tsconfig にも入っていない').toBeGreaterThan(0);
  });

  // ⚠️ **呼ばれていなければ意味が無い**＝設定だけ置いて `typecheck` から外れている状態を防ぐ。
  it('`npm run typecheck` から呼ばれている', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.typecheck, `${CONFIG} が typecheck から呼ばれていない`).toContain(CONFIG);
  });

  // ⚠️ **推移的な依存に乗らない**＝`@types/node` は `vite`/`vitest` の peer 経由で入っていた。
  //   欠けた回に `error TS2688` で **`typecheck` が丸ごと落ちる**。
  // ⚠️ **動かす版に合わせる**（PR #1238 2回目 🟡）＝CI は Node 22。型だけ新しいと、
  //   **その版に無い API を書いても緑**になり、実行時に落ちる（緑の意味が薄まる）。
  it('`@types/node` を、動かす版（Node 22）に合わせて宣言している', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const want = pkg.devDependencies['@types/node'];
    expect(want, '推移的な依存に乗っている').toBeTruthy();
    expect(want, `CI の Node と食い違っている: ${want}`).toMatch(/^\^?22\./);
  });
});

// ⚠️ **門番自身を壊して、赤くなることを確かめる**（`CLAUDE.md` §7）＝
// 「いまの設定がたまたま正しいので緑」と「そもそも見ていないので緑」は、見た目で区別できない。
describe('門番自身の検査', () => {
  it('重大度の読み取りが、数でも言葉でも効く', () => {
    expect(severityOf({ rules: { 'no-undef': 2 } }, 'no-undef')).toBe('error');
    expect(severityOf({ rules: { 'no-undef': 'error' } }, 'no-undef')).toBe('error');
    expect(severityOf({ rules: { 'no-undef': ['error', {}] } }, 'no-undef')).toBe('error');
    expect(severityOf({ rules: { 'no-undef': 1 } }, 'no-undef')).toBe('warn');
  });

  it('当たっていない形を、当たっていると読まない', () => {
    expect(severityOf({ rules: { 'no-undef': 0 } }, 'no-undef')).toBe('off');
    expect(severityOf({ rules: { 'no-undef': 'off' } }, 'no-undef')).toBe('off');
    expect(severityOf({ rules: {} }, 'no-undef'), '規則が無いのに当たっていると読んでいる').toBe('off');
    expect(severityOf({}, 'no-undef')).toBe('off');
  });
});
