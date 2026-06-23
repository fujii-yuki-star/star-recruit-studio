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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },

  // Node で動かすスクリプト・設定ファイル（node グローバル）
  {
    files: ['scripts/**/*.{ts,mjs,js}', '*.config.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
