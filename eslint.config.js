import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ビルド成果物・外部・実験物は対象外
  { ignores: ['dist', 'src-tauri/**', '.spike/**', 'node_modules', 'src/domain/validation/generated/**'] },

  // アプリ本体（React + TS）
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // 日本語UIでは全角スペース等を文字列/JSXテキストに使うため、それらは許可（コード中の不可視文字は検出）
      'no-irregular-whitespace': ['error', { skipStrings: true, skipComments: true, skipTemplates: true, skipJSXText: true }],
      // `_` 接頭辞の引数・変数は未使用を許容（意図的に使わない引数の慣習）
      // ⚠️ `ignoreRestSiblings`＝options を明示すると既定（true）が消えるので書く（PR #1238 レビュー ℹ️）。
      //   これが無いと、同じ `const { keep, ...rest } = x` が **`.mjs` では通り `.ts` では赤**になる。
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },

  // Node で動かすスクリプト・設定ファイル（node グローバル）
  //
  // ⚠️ **規則を当てる**（#1235）＝ここは以前 `globals` を足すだけで **規則がゼロ**だった。
  // そのせいで `scripts/lib/frames.mjs` から `const out = [];` を落としたとき、
  // **未定義の変数を触る状態のまま `npx eslint scripts/` が通った**（PR #1234 の作業中に実際に起きた）。
  // `no-undef` があれば**その場で赤くなる**種類の壊し方だったので、`recommended` を当てる。
  // ⚠️ **`.ts` はここに入れない**（PR #1238 レビュー 🟡）＝素の `no-undef` / `no-unused-vars` は
  //   `tseslint` が TS 向けに**意図的に切っている**（型で見るため）。ここで当て直すと
  //   `NodeJS.Timeout` や enum のメンバ、型の引数名が**理由なく赤**になる（実測で3件出た）。
  //   `.ts` の規則は上のブロック（`**/*.{ts,tsx}`）で既に当たっている。
  {
    files: ['scripts/**/*.{mjs,js}', '*.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // アプリ本体と同じ扱い（日本語のコメント・文言に全角スペースが入る）
      'no-irregular-whitespace': ['error', { skipStrings: true, skipComments: true, skipTemplates: true, skipJSXText: true }],
      // ⚠️ `ignoreRestSiblings`＝`const { format, ...rest } = x` で**わざと外す**書き方を通す
      //   （`validate-schemas.mjs` が「その欄を欠いた検体」を作るのに使っている＝未使用ではなく意図）。
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },

  // `.ts` の道具・設定（node のグローバルだけを足す。規則は上の TS 向けブロックが当てる）
  {
    files: ['scripts/**/*.ts', '*.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
