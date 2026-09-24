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
import { existsSync, readFileSync } from 'node:fs';

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
});

describe('scripts/** に型検査が当たっている（#1235）', () => {
  const raw = existsSync('tsconfig.scripts.json') ? readFileSync('tsconfig.scripts.json', 'utf8') : '';

  it('道具向けの tsconfig がある', () => {
    expect(raw, 'tsconfig.scripts.json が無い').not.toBe('');
  });

  // ⚠️ **`checkJs` が無いと、`.mjs` は置いてあるだけで一切見られない**（拡張子だけ拾って中身は素通り）。
  it('`allowJs` と `checkJs` が入っている', () => {
    const config = JSON.parse(raw.replace(/^\uFEFF/, ''));
    expect(config.compilerOptions.allowJs).toBe(true);
    expect(config.compilerOptions.checkJs, 'checkJs が無い＝置いてあるだけで見ていない').toBe(true);
  });

  it('`scripts/**` の .mjs と .ts の両方を見ている', () => {
    const config = JSON.parse(raw.replace(/^\uFEFF/, ''));
    expect(config.include).toContain('scripts/**/*.mjs');
    expect(config.include, '.ts の道具がどの tsconfig にも入っていない').toContain('scripts/**/*.ts');
  });

  // ⚠️ **呼ばれていなければ意味が無い**＝設定だけ置いて `typecheck` から外れている状態を防ぐ。
  it('`npm run typecheck` から呼ばれている', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.typecheck, 'tsconfig.scripts.json が typecheck から呼ばれていない')
      .toContain('tsconfig.scripts.json');
  });

  // ⚠️ **推移的な依存に乗らない**＝`@types/node` は `vite`/`vitest` の peer 経由で入っていた。
  //   それらが外れた回に `error TS2688` で **`typecheck` が丸ごと落ちる**。
  it('`@types/node` を自分で宣言している', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.devDependencies['@types/node'], '推移的な依存に乗っている').toBeTruthy();
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
