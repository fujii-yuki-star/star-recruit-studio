# Contributing Guide

チームメンバーとAIエージェントが同じ手順で安全に開発するための最短ガイド。

## 1. 参照順序（作業前に上から確認）
1. `README.md`
2. `CLAUDE.md`（AI開発の正典・絶対原則）
3. `docs/yuko_recruit_docs/11_SCHEMA_REFERENCE.md` ＋ `12_AI_PROMPT_AND_MAPPING.md`（データ/AIの正典）
4. `docs/yuko_recruit_docs/14_TEST_STRATEGY.md` ／ 関連 `adr/*`

## 2. セットアップ
標準パッケージマネージャーは **npm**（`package-lock.json` を使用）。

```bash
npm install
npm run tauri dev   # アプリ起動（Rust + WebView）
npm run dev         # フロントのみ
```

## 3. ブランチ運用
- `main`：安定（リリース）ブランチ。直接コミット禁止。
- `develop`：統合ブランチ。**作業ブランチからのPR先は原則 `develop`**。
- 作業ブランチ例：`feat/*` `fix/*` `docs/*` `refactor/*` `chore/*` `ui/*`
- リリース時に `develop` → `main` のPR。

## 4. コミットメッセージ
軽量 Conventional Commits。

```
feat(domain): AI出力→Scene変換に poseTag 解決を追加
fix(renderer): 字幕背景の高さ計算を修正
docs: 12 のマッピング表を更新
chore: CI に schema 検証を追加
```

## 5. ローカル確認（PR前に必須）
最低限フロント、Rust変更時は Rust も。

```bash
npm run check:frontend   # lint + typecheck + test + validate:schemas
# Rust を触ったら:
npm run check:rust && npm run check:rust:fmt && npm run check:rust:clippy && npm run check:rust:test
# まとめて:
npm run review
```

任意で push 前フックを有効化：

```bash
npm run hooks:install    # .githooks/pre-push（frontend チェック）を有効化
```

## 6. PR作成ルール
`.github/PULL_REQUEST_TEMPLATE.md` を使用し、機械チェックと**品質ゲート（CLAUDE.md §7 DoD）**を埋める：
- 通常UIに技術用語を出さない（`06_UI_SPEC §3` / `16_GLOSSARY`）
- 正典（`11`/`12`/`schemas`）と矛盾しない（enum・定数を直書きしない）
- ユーザー向けエラーは「次の行動」を示す（`15_ERROR_STATE_MODEL`）
- 秘密情報をコミット/ログに含めない（`13 §7`）

UI変更時はスクリーンショットを添付。原則 `develop` 向け。

## 7. CI（機械的判定）
PR/`develop`・`main` への push で自動実行：
- **CI**：lint / typecheck / build / `validate:schemas`（Node）＋ cargo check / fmt / clippy（Rust）
- **Test CI**：vitest ＋ cargo test
- **Security CI**：cargo-audit ＋ npm audit（high）
- **Secret Scan**：gitleaks
- **Claude Code Review**：PRコメントで `@claude` メンション時のみ（要 Secret `CLAUDE_CODE_OAUTH_TOKEN`）

`develop` / `main` はブランチ保護で「PR必須・上記チェック必須・直push禁止」を推奨（リポジトリ設定）。

## 8. Issue
- 不具合：`.github/ISSUE_TEMPLATE/bug_report.yml`
- 作業依頼：`.github/ISSUE_TEMPLATE/task_request.yml`

## 9. 秘密情報
APIキー・認証情報はコミット禁止。`.env.example` を参照し、実値は `.env`（gitignore済）またはOS環境変数／OSキーチェーンへ（`13 §7`）。ログ・スクショに含めない。

## 10. AI利用時の注意
生成結果をそのまま採用せず、差分を読み、正典との整合・責務分離（domain/infrastructure/renderer/app）・セキュリティを確認する。PR本文にAI利用メモを残す（任意）。最終責任は人間レビュー。
